using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Arc.Satellite
{
    /// <summary>
    /// C# port of the ARC Satellite JavaScript SDK.
    ///
    /// This class owns the WebSocket connection, session state, heartbeat,
    /// acknowledgements, outbound queue and reconnect policy. Call
    /// DispatchEvents() from Unity's main thread each frame, or use
    /// ArcSatelliteBehaviour which does this automatically.
    /// </summary>
    public sealed class ArcSatelliteClient : IDisposable
    {
        private const int ReceiveBufferSize = 16 * 1024;

        private sealed class PendingAck
        {
            public TaskCompletionSource<JObject> Completion;
            public CancellationTokenSource Timeout;
        }

        private readonly ArcSatelliteOptions _options;
        private readonly object _stateGate = new object();
        private readonly object _triggerGate = new object();
        private readonly SemaphoreSlim _connectGate = new SemaphoreSlim(1, 1);
        private readonly SemaphoreSlim _sendGate = new SemaphoreSlim(1, 1);
        private readonly ConcurrentQueue<JObject> _messageQueue = new ConcurrentQueue<JObject>();
        private readonly ConcurrentQueue<Action> _eventQueue = new ConcurrentQueue<Action>();
        private readonly ConcurrentDictionary<string, PendingAck> _pendingAcks =
            new ConcurrentDictionary<string, PendingAck>();
        private readonly Dictionary<string, ArcTriggerDefinition> _triggers =
            new Dictionary<string, ArcTriggerDefinition>(StringComparer.Ordinal);

        private ClientWebSocket _socket;
        private CancellationTokenSource _connectionLifetime;
        private CancellationTokenSource _reconnectLifetime;
        private Task _connectionTask;
        private string _sessionId;
        private JObject _customer;
        private bool _connected;
        private bool _intentionalClose;
        private bool _disposed;
        private TimeSpan _reconnectDelay;

        public event Action Opened;
        public event Action<ArcCloseInfo> Closed;
        public event Action<Exception> Error;
        public event Action<ArcSessionStartEvent> SessionStarted;
        public event Action<ArcSessionEndEvent> SessionEnded;
        public event Action<JObject> CommandReceived;
        public event Action<JObject> MessageReceived;
        public event Action<JToken> ContentReceived;
        public event Action<JObject> Acknowledged;

        public ArcSatelliteClient(ArcSatelliteOptions options = null)
        {
            _options = options ?? new ArcSatelliteOptions();
            _reconnectDelay = _options.ReconnectDelay;
            RegisterTriggerDefinitionsLocally(_options.Triggers);
        }

        public bool Connected
        {
            get { lock (_stateGate) return _connected; }
        }

        public string SessionId
        {
            get { lock (_stateGate) return _sessionId; }
        }

        public JObject Customer
        {
            get
            {
                lock (_stateGate)
                    return _customer == null ? null : (JObject)_customer.DeepClone();
            }
        }

        public Uri WebSocketUri => _options.WebSocketUri;

        /// <summary>
        /// Opens the connection. Safe to call repeatedly.
        /// </summary>
        public void Connect()
        {
            ThrowIfDisposed();
            lock (_stateGate)
            {
                if (_connectionTask != null && !_connectionTask.IsCompleted)
                    return;

                _intentionalClose = false;
                _reconnectLifetime?.Cancel();
                _reconnectLifetime?.Dispose();
                _reconnectLifetime = new CancellationTokenSource();
                _connectionTask = RunConnectionAsync(_reconnectLifetime.Token);
            }
        }

        /// <summary>
        /// Stops the connection and all automatic reconnect attempts.
        /// </summary>
        public async Task DisconnectAsync()
        {
            ClientWebSocket socket;
            CancellationTokenSource lifetime;

            lock (_stateGate)
            {
                _intentionalClose = true;
                _reconnectLifetime?.Cancel();
                lifetime = _connectionLifetime;
                socket = _socket;
            }

            lifetime?.Cancel();

            if (socket != null &&
                (socket.State == WebSocketState.Open || socket.State == WebSocketState.CloseReceived))
            {
                try
                {
                    using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2)))
                    {
                        await socket.CloseAsync(
                            WebSocketCloseStatus.NormalClosure,
                            "client disconnect",
                            timeout.Token);
                    }
                }
                catch
                {
                    socket.Abort();
                }
            }
        }

        /// <summary>
        /// Executes queued SDK callbacks. Invoke from Unity Update().
        /// </summary>
        public void DispatchEvents(int maximum = 256)
        {
            var dispatched = 0;
            while (dispatched < maximum && _eventQueue.TryDequeue(out var callback))
            {
                try { callback(); }
                catch (Exception exception) { Debug.LogException(exception); }
                dispatched++;
            }
        }

        public void SendTrigger(string triggerId, JObject payload = null)
        {
            if (string.IsNullOrWhiteSpace(triggerId))
                throw new ArgumentException("A trigger ID is required.", nameof(triggerId));

            var message = WithSession(new JObject
            {
                ["type"] = "trigger",
                ["trigger_id"] = triggerId,
                ["payload"] = payload ?? new JObject()
            });
            QueueSend(message);
        }

        public Task<JObject> SendTriggerAsync(
            string triggerId,
            JObject payload = null,
            CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(triggerId))
                throw new ArgumentException("A trigger ID is required.", nameof(triggerId));

            var message = WithSession(new JObject
            {
                ["type"] = "trigger",
                ["trigger_id"] = triggerId,
                ["payload"] = payload ?? new JObject()
            });
            return SendWithAckAsync(message, cancellationToken);
        }

        public void SendScore(double score, JObject metadata = null)
        {
            var payload = metadata == null ? new JObject() : (JObject)metadata.DeepClone();
            payload["score"] = score;
            SendTrigger("score-achieved", payload);
        }

        public void SendMessage(string type, JObject payload = null)
        {
            if (string.IsNullOrWhiteSpace(type))
                throw new ArgumentException("A message type is required.", nameof(type));

            QueueSend(WithSession(new JObject
            {
                ["type"] = type,
                ["payload"] = payload ?? new JObject()
            }));
        }

        public Task<JObject> SendContentUrlAsync(
            string url,
            string mimeType = "application/octet-stream",
            JObject metadata = null,
            CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(url))
                throw new ArgumentException("A URL is required.", nameof(url));

            return SendWithAckAsync(WithSession(new JObject
            {
                ["type"] = "ugc-upload",
                ["url"] = url,
                ["mime_type"] = mimeType,
                ["meta"] = metadata ?? new JObject()
            }), cancellationToken);
        }

        public Task<JObject> SendContentBytesAsync(
            byte[] data,
            string mimeType = "application/octet-stream",
            JObject metadata = null,
            CancellationToken cancellationToken = default)
        {
            if (data == null)
                throw new ArgumentNullException(nameof(data));

            return SendWithAckAsync(WithSession(new JObject
            {
                ["type"] = "ugc-upload",
                ["data"] = Convert.ToBase64String(data),
                ["mime_type"] = mimeType,
                ["meta"] = metadata ?? new JObject()
            }), cancellationToken);
        }

        public void ConfirmReceipt(string messageId)
        {
            if (string.IsNullOrWhiteSpace(messageId))
                return;

            QueueSend(new JObject
            {
                ["type"] = "ack",
                ["message_id"] = messageId
            });
        }

        /// <summary>
        /// App-initiated session end. The SDK sends close-session and clears
        /// its local session/customer immediately, matching the JavaScript SDK.
        /// </summary>
        public void CloseSession()
        {
            string sessionId;
            lock (_stateGate)
            {
                sessionId = _sessionId;
                if (string.IsNullOrWhiteSpace(sessionId))
                    return;
                _sessionId = null;
                _customer = null;
            }

            QueueSend(new JObject
            {
                ["type"] = "close-session",
                ["session_id"] = sessionId
            });
        }

        public void RegisterTriggers(IEnumerable<ArcTriggerDefinition> triggers)
        {
            if (triggers == null)
                return;

            RegisterTriggerDefinitionsLocally(triggers);
            if (Connected)
            {
                QueueSend(new JObject
                {
                    ["type"] = "register-triggers",
                    ["triggers"] = JArray.FromObject(GetTriggerSnapshot())
                });
            }
        }

        private async Task RunConnectionAsync(CancellationToken reconnectToken)
        {
            while (!reconnectToken.IsCancellationRequested)
            {
                await _connectGate.WaitAsync(reconnectToken);
                try
                {
                    if (Connected)
                        return;
                    await OpenAndRunSocketAsync(reconnectToken);
                }
                catch (OperationCanceledException) when (reconnectToken.IsCancellationRequested)
                {
                    return;
                }
                catch (Exception exception)
                {
                    EnqueueError(exception);
                }
                finally
                {
                    _connectGate.Release();
                }

                bool shouldReconnect;
                lock (_stateGate)
                    shouldReconnect = !_intentionalClose && _options.AutoReconnect;

                if (!shouldReconnect || reconnectToken.IsCancellationRequested)
                    return;

                var delay = _reconnectDelay;
                Log($"Reconnecting in {delay.TotalMilliseconds:0}ms...");
                try { await Task.Delay(delay, reconnectToken); }
                catch (OperationCanceledException) { return; }

                _reconnectDelay = TimeSpan.FromMilliseconds(Math.Min(
                    _reconnectDelay.TotalMilliseconds * _options.ReconnectFactor,
                    _options.MaximumReconnectDelay.TotalMilliseconds));
            }
        }

        private async Task OpenAndRunSocketAsync(CancellationToken reconnectToken)
        {
            var socket = new ClientWebSocket();
            var lifetime = CancellationTokenSource.CreateLinkedTokenSource(reconnectToken);

            lock (_stateGate)
            {
                _socket = socket;
                _connectionLifetime = lifetime;
            }

            Log($"Connecting to {WebSocketUri}...");

            try
            {
                await socket.ConnectAsync(WebSocketUri, lifetime.Token);
                lock (_stateGate)
                {
                    _connected = true;
                    _reconnectDelay = _options.ReconnectDelay;
                }

                Log("Connected to Satellite");
                EnqueueEvent(() => Opened?.Invoke());

                await SendNowAsync(BuildHello(), lifetime.Token);
                await FlushMessageQueueAsync(lifetime.Token);

                var receiveTask = ReceiveLoopAsync(socket, lifetime.Token);
                var heartbeatTask = HeartbeatLoopAsync(socket, lifetime.Token);
                await receiveTask;
                lifetime.Cancel();
                try { await heartbeatTask; } catch (OperationCanceledException) { }
            }
            finally
            {
                int? closeCode = socket.CloseStatus.HasValue ? (int)socket.CloseStatus.Value : null;
                var closeReason = socket.CloseStatusDescription;
                bool intentional;

                lock (_stateGate)
                {
                    intentional = _intentionalClose;
                    _connected = false;
                    if (ReferenceEquals(_socket, socket))
                        _socket = null;
                    if (ReferenceEquals(_connectionLifetime, lifetime))
                        _connectionLifetime = null;
                }

                RejectAllAcks(new IOException("ARC Satellite connection closed."));
                EnqueueEvent(() => Closed?.Invoke(new ArcCloseInfo
                {
                    Code = closeCode,
                    Reason = closeReason,
                    WasIntentional = intentional
                }));

                lifetime.Dispose();
                socket.Dispose();
            }
        }

        private JObject BuildHello()
        {
            var message = new JObject
            {
                ["type"] = "hello",
                ["app"] = _options.AppName,
                ["version"] = _options.AppVersion
            };
            var triggers = GetTriggerSnapshot();
            if (triggers.Count > 0)
                message["triggers"] = JArray.FromObject(triggers);
            return message;
        }

        private async Task ReceiveLoopAsync(
            ClientWebSocket socket,
            CancellationToken cancellationToken)
        {
            var buffer = new byte[ReceiveBufferSize];
            using (var stream = new MemoryStream())
            {
                while (!cancellationToken.IsCancellationRequested &&
                       socket.State == WebSocketState.Open)
                {
                    WebSocketReceiveResult result;
                    try
                    {
                        result = await socket.ReceiveAsync(
                            new ArraySegment<byte>(buffer),
                            cancellationToken);
                    }
                    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                    {
                        return;
                    }

                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        if (socket.State == WebSocketState.CloseReceived)
                        {
                            await socket.CloseOutputAsync(
                                WebSocketCloseStatus.NormalClosure,
                                "close acknowledged",
                                CancellationToken.None);
                        }
                        return;
                    }

                    if (result.MessageType != WebSocketMessageType.Text)
                        continue;

                    stream.Write(buffer, 0, result.Count);
                    if (!result.EndOfMessage)
                        continue;

                    var json = Encoding.UTF8.GetString(stream.ToArray());
                    stream.SetLength(0);

                    JObject message;
                    try { message = JObject.Parse(json); }
                    catch (JsonException)
                    {
                        Log($"Ignoring non-JSON message: {json}");
                        continue;
                    }

                    HandleMessage(message);
                }
            }
        }

        private async Task HeartbeatLoopAsync(
            ClientWebSocket socket,
            CancellationToken cancellationToken)
        {
            if (_options.PingInterval <= TimeSpan.Zero)
                return;

            while (!cancellationToken.IsCancellationRequested &&
                   socket.State == WebSocketState.Open)
            {
                await Task.Delay(_options.PingInterval, cancellationToken);
                if (cancellationToken.IsCancellationRequested)
                    return;

                if (_options.PongTimeout <= TimeSpan.Zero)
                {
                    await SendNowAsync(new JObject { ["type"] = "ping" }, cancellationToken);
                    continue;
                }

                var pong = new TaskCompletionSource<bool>(
                    TaskCreationOptions.RunContinuationsAsynchronously);
                void PongHandler() => pong.TrySetResult(true);
                // Subscribe before sending so an immediate local pong cannot
                // arrive in the small gap between SendAsync and registration.
                _pongReceived += PongHandler;

                try
                {
                    await SendNowAsync(new JObject { ["type"] = "ping" }, cancellationToken);
                    var timeout = Task.Delay(_options.PongTimeout, cancellationToken);
                    var completed = await Task.WhenAny(pong.Task, timeout);
                    if (completed == pong.Task)
                        continue;
                    if (cancellationToken.IsCancellationRequested)
                        return;

                    var exception = new TimeoutException("ARC Satellite pong timeout.");
                    EnqueueError(exception);
                    lock (_stateGate)
                        _reconnectDelay = _options.MaximumReconnectDelay;
                    socket.Abort();
                    return;
                }
                finally
                {
                    _pongReceived -= PongHandler;
                }
            }
        }

        private event Action _pongReceived;

        private void HandleMessage(JObject message)
        {
            var type = message.Value<string>("type");
            Log($"<- {type}: {message.ToString(Formatting.None)}");
            EnqueueEvent(() => MessageReceived?.Invoke((JObject)message.DeepClone()));

            switch (type)
            {
                case "pong":
                    _pongReceived?.Invoke();
                    break;

                case "ack":
                    HandleAck(message);
                    EnqueueEvent(() => Acknowledged?.Invoke((JObject)message.DeepClone()));
                    break;

                case "session-start":
                    HandleSessionStart(message);
                    break;

                case "session-end":
                    HandleSessionEnd(message);
                    break;

                case "command":
                    EnqueueEvent(() => CommandReceived?.Invoke((JObject)message.DeepClone()));
                    ConfirmReceipt(message.Value<string>("message_id"));
                    break;

                case "content":
                    var content = message["payload"] ?? message;
                    EnqueueEvent(() => ContentReceived?.Invoke(content.DeepClone()));
                    ConfirmReceipt(message.Value<string>("message_id"));
                    break;

                default:
                    EnqueueEvent(() => CommandReceived?.Invoke((JObject)message.DeepClone()));
                    break;
            }
        }

        private void HandleSessionStart(JObject message)
        {
            var sessionId = (
                message.Value<string>("session_id") ??
                message.SelectToken("payload.session_id")?.Value<string>()
            )?.Trim();
            var customer = message["customer"] as JObject ??
                           message.SelectToken("payload.customer") as JObject;

            if (string.IsNullOrWhiteSpace(sessionId))
            {
                EnqueueError(new InvalidDataException(
                    "ARC session-start did not contain a valid session_id."));
                return;
            }

            // Store the session before queueing SessionStarted. The Unity game
            // can therefore call SendTrigger from inside its event handler and
            // the trigger will already receive this exact session_id.
            lock (_stateGate)
            {
                _sessionId = sessionId;
                _customer = customer == null ? null : (JObject)customer.DeepClone();
            }
            Log($"Session stored: session_id={sessionId}");

            var sessionEvent = new ArcSessionStartEvent
            {
                SessionId = sessionId,
                Customer = customer == null ? null : (JObject)customer.DeepClone(),
                Action = message.Value<string>("action"),
                Payload = message["payload"]?.DeepClone(),
                RawMessage = (JObject)message.DeepClone()
            };
            EnqueueEvent(() => SessionStarted?.Invoke(sessionEvent));

            // Match the JavaScript SDK: confirm the routed session before
            // acknowledging the individual inbound message.
            QueueSend(new JObject
            {
                ["type"] = "session-started",
                ["session_id"] = sessionId
            });
            ConfirmReceipt(message.Value<string>("message_id"));
        }

        private void HandleSessionEnd(JObject message)
        {
            string sessionId;
            lock (_stateGate)
            {
                sessionId = message.Value<string>("session_id") ?? _sessionId;
                _sessionId = null;
                _customer = null;
            }

            var sessionEvent = new ArcSessionEndEvent
            {
                SessionId = sessionId,
                RawMessage = (JObject)message.DeepClone()
            };
            EnqueueEvent(() => SessionEnded?.Invoke(sessionEvent));
            QueueSend(new JObject
            {
                ["type"] = "session-ended",
                ["session_id"] = sessionId
            });
        }

        private void HandleAck(JObject message)
        {
            var messageId = message.Value<string>("message_id") ??
                            message.Value<string>("ack_id");
            if (string.IsNullOrWhiteSpace(messageId))
                return;

            if (_pendingAcks.TryRemove(messageId, out var pending))
            {
                pending.Timeout.Cancel();
                pending.Timeout.Dispose();
                pending.Completion.TrySetResult((JObject)message.DeepClone());
            }
        }

        private Task<JObject> SendWithAckAsync(
            JObject message,
            CancellationToken cancellationToken)
        {
            var messageId = GenerateMessageId();
            message["message_id"] = messageId;
            message["request_ack"] = true;

            var completion = new TaskCompletionSource<JObject>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(_options.AckTimeout);
            var pending = new PendingAck { Completion = completion, Timeout = timeout };

            if (!_pendingAcks.TryAdd(messageId, pending))
                throw new InvalidOperationException("Could not register ARC acknowledgement.");

            timeout.Token.Register(() =>
            {
                if (_pendingAcks.TryRemove(messageId, out var expired))
                {
                    expired.Completion.TrySetException(
                        new TimeoutException($"Ack timeout for message {messageId}."));
                    expired.Timeout.Dispose();
                }
            });

            QueueSend(message);
            return completion.Task;
        }

        private void QueueSend(JObject message)
        {
            ThrowIfDisposed();
            _ = SendOrQueueAsync((JObject)message.DeepClone());
        }

        private async Task SendOrQueueAsync(JObject message)
        {
            ClientWebSocket socket;
            CancellationToken token;
            lock (_stateGate)
            {
                socket = _socket;
                token = _connectionLifetime?.Token ?? CancellationToken.None;
            }

            if (socket != null && socket.State == WebSocketState.Open)
            {
                try
                {
                    await SendNowAsync(message, token);
                    return;
                }
                catch (Exception exception)
                {
                    EnqueueError(exception);
                }
            }

            var type = message.Value<string>("type");
            if (type != "ping" && type != "pong" && type != "ack")
                _messageQueue.Enqueue(message);
        }

        private async Task SendNowAsync(JObject message, CancellationToken cancellationToken)
        {
            ClientWebSocket socket;
            lock (_stateGate) socket = _socket;
            if (socket == null || socket.State != WebSocketState.Open)
                throw new InvalidOperationException("ARC Satellite WebSocket is not open.");

            var bytes = Encoding.UTF8.GetBytes(message.ToString(Formatting.None));
            await _sendGate.WaitAsync(cancellationToken);
            try
            {
                await socket.SendAsync(
                    new ArraySegment<byte>(bytes),
                    WebSocketMessageType.Text,
                    true,
                    cancellationToken);
                Log($"-> {message.Value<string>("type")}: {message.ToString(Formatting.None)}");
            }
            finally
            {
                _sendGate.Release();
            }
        }

        private async Task FlushMessageQueueAsync(CancellationToken cancellationToken)
        {
            while (_messageQueue.TryDequeue(out var message))
                await SendNowAsync(message, cancellationToken);
        }

        private JObject WithSession(JObject message)
        {
            var sessionId = SessionId;
            var messageType = message.Value<string>("type");
            if (!string.IsNullOrWhiteSpace(sessionId))
            {
                message["session_id"] = sessionId;
                Log(
                    $"Session attached: type={messageType}, " +
                    $"session_id={sessionId}");
            }
            else if (messageType == "trigger")
            {
                var triggerId = message.Value<string>("trigger_id");
                Log(
                    $"WARNING: trigger '{triggerId}' " +
                    "was created without an active session_id.");
            }
            return message;
        }

        private void RegisterTriggerDefinitionsLocally(
            IEnumerable<ArcTriggerDefinition> triggers)
        {
            if (triggers == null)
                return;

            lock (_triggerGate)
            {
                foreach (var trigger in triggers)
                {
                    if (trigger == null || string.IsNullOrWhiteSpace(trigger.Id))
                        continue;
                    _triggers[trigger.Id] = new ArcTriggerDefinition(
                        trigger.Id,
                        trigger.Name,
                        trigger.Description);
                }
            }
        }

        private List<ArcTriggerDefinition> GetTriggerSnapshot()
        {
            lock (_triggerGate)
                return _triggers.Values
                    .Select(trigger => new ArcTriggerDefinition(
                        trigger.Id,
                        trigger.Name,
                        trigger.Description))
                    .ToList();
        }

        private void RejectAllAcks(Exception exception)
        {
            foreach (var entry in _pendingAcks.ToArray())
            {
                if (_pendingAcks.TryRemove(entry.Key, out var pending))
                {
                    pending.Timeout.Cancel();
                    pending.Timeout.Dispose();
                    pending.Completion.TrySetException(exception);
                }
            }
        }

        private void EnqueueEvent(Action callback)
        {
            if (callback != null)
                _eventQueue.Enqueue(callback);
        }

        private void EnqueueError(Exception exception)
        {
            Log(exception.ToString());
            EnqueueEvent(() => Error?.Invoke(exception));
        }

        private static string GenerateMessageId()
        {
            return $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-" +
                   Guid.NewGuid().ToString("N").Substring(0, 6);
        }

        private void Log(string message)
        {
            if (_options.Debug)
                Debug.Log($"[arc-sdk] {message}");
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
                throw new ObjectDisposedException(nameof(ArcSatelliteClient));
        }

        public void Dispose()
        {
            if (_disposed)
                return;
            _disposed = true;
            _intentionalClose = true;
            _reconnectLifetime?.Cancel();
            _connectionLifetime?.Cancel();
            _socket?.Abort();
            RejectAllAcks(new ObjectDisposedException(nameof(ArcSatelliteClient)));
        }
    }
}
