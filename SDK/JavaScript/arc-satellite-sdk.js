/**
 * Arc Satellite SDK  v1.0.0
 * =========================
 * JavaScript client library for venue applications communicating with the
 * standalone ARC Client running on the same machine.
 *
 * The ARC Client exposes a local WebSocket server (default port 25585)
 * and optionally HTTP (25586), TCP (25587) and UDP (25588) transports.
 * This SDK targets the WebSocket transport.
 *
 * Usage (ESM / browser):
 *   import { ArcSatelliteClient } from './arc-satellite-sdk.js';
 *   const arc = new ArcSatelliteClient();
 *   arc.connect();
 *
 * Usage (Node.js / CommonJS):
 *   const { ArcSatelliteClient } = require('./arc-satellite-sdk.js');
 *
 * Events emitted (use .on(event, handler)):
 *   'open'            — WebSocket connected to Satellite
 *   'close'           — WebSocket closed
 *   'error'           — Connection or protocol error (Error object)
 *   'session-start'   — Player session started; handler receives { customer, session_id }
 *   'session-end'     — Player session ended; handler receives { session_id }
 *   'command'         — Raw command from Arc server; handler receives the full message object
 *   'message'         — Any inbound message; handler receives the full message object
 *   'content'         — Content delivery (UGC, media); handler receives { url, type, meta }
 *   'ack'             — Server acknowledged a message sent by this app
 */

(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined'
    ? (module.exports = factory())
    : typeof define === 'function' && define.amd
    ? define(factory)
    : ((global = global || self), (global.ArcSatelliteSDK = factory()));
})(this, function () {
  'use strict';

  const DEFAULT_HOST = 'localhost';
  const DEFAULT_PORT = 25585;
  const DEFAULT_RECONNECT_DELAY = 2000;   // ms before first reconnect attempt
  const MAX_RECONNECT_DELAY   = 30000;    // ms ceiling for exponential back-off
  const RECONNECT_FACTOR      = 1.5;      // back-off multiplier
  const DEFAULT_PING_INTERVAL = 25000;    // ms between keep-alive pings (0 = disabled)
  const DEFAULT_PONG_TIMEOUT  = 10000;    // ms to wait for a pong before treating the link as dead
  const ACK_TIMEOUT           = 8000;     // ms to wait for a receipt ack

  /* ─────────────────────── tiny EventEmitter ─────────────────────── */
  class EventEmitter {
    constructor() { this._listeners = {}; }
    on(event, fn) {
      (this._listeners[event] = this._listeners[event] || []).push(fn);
      return this;
    }
    off(event, fn) {
      if (!this._listeners[event]) return this;
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
      return this;
    }
    once(event, fn) {
      const wrapper = (...args) => { fn(...args); this.off(event, wrapper); };
      return this.on(event, wrapper);
    }
    emit(event, ...args) {
      (this._listeners[event] || []).forEach(fn => { try { fn(...args); } catch (e) { console.error('[arc-sdk] listener error', e); } });
    }
  }

  /* ─────────────────────── main client class ─────────────────────── */
  class ArcSatelliteClient extends EventEmitter {
    /**
     * @param {object} [options]
     * @param {string} [options.host='localhost']        Satellite host
     * @param {number} [options.port=25585]              Satellite WebSocket port
     * @param {string} [options.appName]                 Name sent in the hello message
     * @param {string} [options.appVersion]              Version sent in the hello message
     * @param {boolean} [options.autoReconnect=true]     Reconnect on drop
     * @param {number}  [options.pingInterval=25000]     ms between keep-alive pings; set to 0 to disable
     * @param {number}  [options.pongTimeout=10000]      ms to wait for a pong reply before reconnecting; set to 0 to disable
     * @param {boolean} [options.debug=false]            Log every message to console
     * @param {Array<{id:string,name:string,description?:string}>} [options.triggers]
     *        Trigger definitions to register with the satellite on connect.
     *        Each entry needs at minimum `id` and `name`.
     */
    constructor(options = {}) {
      super();
      this._host          = options.host        || DEFAULT_HOST;
      this._port          = options.port        || DEFAULT_PORT;
      this._appName       = options.appName     || 'Local App';
      this._appVersion    = options.appVersion  || '1.0.0';
      this._autoReconnect  = options.autoReconnect !== false;
      this._pingInterval   = options.pingInterval !== undefined ? options.pingInterval : DEFAULT_PING_INTERVAL;
      this._pongTimeout    = options.pongTimeout  !== undefined ? options.pongTimeout  : DEFAULT_PONG_TIMEOUT;
      this._debug          = options.debug       || false;
      this._triggers       = Array.isArray(options.triggers) ? options.triggers : null;

      this._ws            = null;
      this._sessionId     = null;
      this._customer      = null;
      this._connected     = false;
      this._intentionalClose = false;
      this._reconnectDelay   = DEFAULT_RECONNECT_DELAY;
      this._reconnectTimer   = null;
      this._pingTimer        = null;
      this._pongTimer        = null;   // per-ping deadline; fires if no pong arrives in time
      this._pendingAcks      = {};   // msgId → { resolve, reject, timer }
      this._msgQueue         = [];   // messages queued while disconnected
    }

    /* ── public state ─────────────────────────────────────────────── */
    get connected()  { return this._connected; }
    get sessionId()  { return this._sessionId; }
    get customer()   { return this._customer ? { ...this._customer } : null; }
    get wsUrl()      { return `ws://${this._host}:${this._port}`; }

    /* ── connect / disconnect ─────────────────────────────────────── */

    /**
     * Open the WebSocket connection to the Satellite.
     * Safe to call multiple times — no-ops if already connected.
     */
    connect() {
      if (this._ws && this._ws.readyState <= 1 /* OPEN or CONNECTING */) return;
      this._intentionalClose = false;
      this._openWs();
    }

    /**
     * Gracefully close the connection. No further reconnect attempts.
     */
    disconnect() {
      this._intentionalClose = true;
      this._clearTimers();
      if (this._ws) {
        try { this._ws.close(1000, 'client disconnect'); } catch (_) {}
        this._ws = null;
      }
      this._connected = false;
    }

    /* ── sending messages ────────────────────────────────────────── */

    /**
     * Fire a trigger event at the Arc server.
     * @param {string} triggerId   The trigger ID configured in the Satellite (e.g. 'game-completed')
     * @param {object} [payload]   Optional key-value data included with the trigger
     * @param {object} [options]
     * @param {boolean} [options.awaitAck=false]  Wait for server acknowledgement (returns Promise)
     */
    sendTrigger(triggerId, payload = {}, options = {}) {
      const msg = {
        type: 'trigger',
        trigger_id: triggerId,
        payload,
        ...(this._sessionId ? { session_id: this._sessionId } : {}),
      };
      if (options.awaitAck) {
        msg.message_id = this._genId();
        msg.request_ack = true;
        return this._sendWithAck(msg);
      }
      this._send(msg);
    }

    /**
     * Send a score or stat update to the server.
     * @param {number} score          The player's final or current score
     * @param {object} [metadata]     Extra game-specific data (level, time, etc.)
     */
    sendScore(score, metadata = {}) {
      return this.sendTrigger('score-achieved', { score, ...metadata });
    }

    /**
     * Send an arbitrary typed message to the Arc server via the Satellite.
     * @param {string} type      Message type string
     * @param {object} [payload]
     */
    sendMessage(type, payload = {}) {
      const msg = {
        type,
        payload,
        ...(this._sessionId ? { session_id: this._sessionId } : {}),
      };
      this._send(msg);
    }

    /**
     * Upload user-generated content (photo, video, result screen) to the platform.
     * Pass a Blob/File (browser) or a Buffer (Node.js with ws library) as `data`.
     * Alternatively pass a publicly accessible URL string for the server to fetch.
     *
     * @param {Blob|File|Buffer|string} data    Binary content or URL
     * @param {string}  [mimeType]             MIME type (e.g. 'image/jpeg')
     * @param {object}  [meta]                 Extra metadata stored with the upload
     * @returns {Promise<object>}              Resolves with { upload_id, url }
     */
    sendContent(data, mimeType = 'application/octet-stream', meta = {}) {
      // If data is a URL string, instruct the satellite to fetch it server-side
      if (typeof data === 'string') {
        const msg = {
          type: 'ugc-upload',
          message_id: this._genId(),
          request_ack: true,
          url: data,
          mime_type: mimeType,
          meta,
          ...(this._sessionId ? { session_id: this._sessionId } : {}),
        };
        return this._sendWithAck(msg);
      }

      // Binary payload — base64-encode for JSON transport
      return new Promise((resolve, reject) => {
        const reader = typeof FileReader !== 'undefined' ? new FileReader() : null;
        if (reader && data instanceof Blob) {
          reader.onload = () => {
            const b64 = reader.result.split(',')[1];
            const msg = {
              type: 'ugc-upload',
              message_id: this._genId(),
              request_ack: true,
              data: b64,
              mime_type: mimeType,
              meta,
              ...(this._sessionId ? { session_id: this._sessionId } : {}),
            };
            this._sendWithAck(msg).then(resolve).catch(reject);
          };
          reader.onerror = reject;
          reader.readAsDataURL(data);
        } else {
          // Node.js Buffer
          const b64 = Buffer.isBuffer(data) ? data.toString('base64') : btoa(String.fromCharCode(...new Uint8Array(data)));
          const msg = {
            type: 'ugc-upload',
            message_id: this._genId(),
            request_ack: true,
            data: b64,
            mime_type: mimeType,
            meta,
            ...(this._sessionId ? { session_id: this._sessionId } : {}),
          };
          this._sendWithAck(msg).then(resolve).catch(reject);
        }
      });
    }

    /**
     * Explicitly confirm receipt of a message from the server.
     * @param {string} messageId   The message_id field from the server message
     */
    confirmReceipt(messageId) {
      this._send({ type: 'ack', message_id: messageId });
    }

    /**
     * Close the current player session (app-initiated end).
     * Sends close-session to the satellite which relays session_ended to the cloud.
     * Note: when the cloud ends the session first (session-end event), the SDK
     * automatically sends session-ended back — you do not need to call this manually.
     */
    closeSession() {
      if (!this._sessionId) return;
      this._send({ type: 'close-session', session_id: this._sessionId });
      this._sessionId = null;
      this._customer  = null;
    }

    /**
     * Register (or update) trigger definitions with the satellite.
     * If already connected, sends a `register-triggers` message immediately.
     * If not yet connected, the list is merged and included in the next hello.
     *
     * @param {Array<{id:string,name:string,description?:string}>} triggers
     */
    registerTriggers(triggers) {
      if (!Array.isArray(triggers) || triggers.length === 0) return;
      // Merge with any previously registered triggers (deduplicate by id)
      const map = {};
      (this._triggers || []).forEach(t => { if (t.id) map[t.id] = t; });
      triggers.forEach(t => { if (t.id) map[t.id] = { ...map[t.id], ...t }; });
      this._triggers = Object.values(map);
      if (this._connected) {
        this._send({ type: 'register-triggers', triggers: this._triggers });
      }
    }

    /* ── low-level internals ─────────────────────────────────────── */

    _openWs() {
      this._clearTimers();
      this._log(`Connecting to ${this.wsUrl}…`);
      const WS = typeof WebSocket !== 'undefined' ? WebSocket
        : require('ws'); // Node.js fallback (ws package)
      this._ws = new WS(this.wsUrl);

      this._ws.onopen = () => {
        this._log('Connected to Satellite');
        this._connected = true;
        this._reconnectDelay = DEFAULT_RECONNECT_DELAY;
        this.emit('open');

        // Announce ourselves (include triggers if pre-registered via constructor or registerTriggers)
        const helloMsg = { type: 'hello', app: this._appName, version: this._appVersion };
        if (this._triggers && this._triggers.length > 0) helloMsg.triggers = this._triggers;
        this._send(helloMsg);

        // Flush queued messages
        const q = [...this._msgQueue];
        this._msgQueue = [];
        q.forEach(m => this._send(m));

        // Start keep-alive (skip if disabled)
        if (this._pingInterval > 0) {
          this._pingTimer = setInterval(() => {
            this._send({ type: 'ping' });
            // Arm a deadline for the pong reply.  If it fires the link is dead.
            if (this._pongTimeout > 0 && !this._pongTimer) {
              this._pongTimer = setTimeout(() => {
                this._pongTimer = null;
                this._log('Pong timeout — link appears dead, reconnecting…');
                this.emit('error', new Error('Pong timeout'));
                // Use a fixed 30-second interval for pong-timeout-driven reconnects.
                this._reconnectDelay = MAX_RECONNECT_DELAY;
                if (this._ws) {
                  try { this._ws.close(1001, 'pong timeout'); } catch (_) {}
                }
              }, this._pongTimeout);
            }
          }, this._pingInterval);
        }
      };

      this._ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch (e) {
          this._log('Non-JSON message', event.data);
          return;
        }
        this._handleMessage(msg);
      };

      this._ws.onclose = (event) => {
        this._log(`Connection closed (code=${event.code})`);
        this._connected = false;
        this._clearTimers();
        this._ws = null;
        this._rejectAllAcks(new Error('Connection closed'));
        this.emit('close', event);
        if (!this._intentionalClose && this._autoReconnect) {
          this._scheduleReconnect();
        }
      };

      this._ws.onerror = (err) => {
        this._log('WebSocket error', err);
        this.emit('error', err);
      };
    }

    _handleMessage(msg) {
      this._log('←', msg.type, msg);
      this.emit('message', msg);

      switch (msg.type) {
        case 'pong':
          // Cancel the per-ping deadline — link is healthy.
          if (this._pongTimer) { clearTimeout(this._pongTimer); this._pongTimer = null; }
          break;

        case 'ack': {
          const mid = msg.message_id || msg.ack_id;
          if (mid && this._pendingAcks[mid]) {
            clearTimeout(this._pendingAcks[mid].timer);
            this._pendingAcks[mid].resolve(msg);
            delete this._pendingAcks[mid];
          }
          this.emit('ack', msg);
          break;
        }

        case 'session-start': {
          const sid = msg.session_id || (msg.payload && msg.payload.session_id);
          const customer = msg.customer || (msg.payload && msg.payload.customer) || null;
          this._sessionId = sid;
          this._customer  = customer;
          this._log(`Session started: ${sid}`);
          // action and payload are present when this session-start originated from
          // a command (e.g. an RFID tap); they are null for bare session_start events.
          this.emit('session-start', {
            session_id: sid,
            customer,
            action:  msg.action  || null,
            payload: msg.payload || null,
          });
          // Auto-confirm to satellite so it can relay session-started to the cloud.
          // This must happen BEFORE the cloud records the session as active.
          this._send({ type: 'session-started', session_id: sid });
          if (msg.message_id) this.confirmReceipt(msg.message_id);
          break;
        }

        case 'session-end': {
          const sid = msg.session_id || this._sessionId;
          this._sessionId = null;
          this._customer  = null;
          this.emit('session-end', { session_id: sid });
          // Auto-confirm to satellite so it can relay session_ended to the cloud.
          this._send({ type: 'session-ended', session_id: sid });
          break;
        }

        case 'command':
          this.emit('command', msg);
          if (msg.message_id) this.confirmReceipt(msg.message_id);
          break;

        case 'content':
          this.emit('content', msg.payload || msg);
          if (msg.message_id) this.confirmReceipt(msg.message_id);
          break;

        default:
          this.emit('command', msg); // forward unknown types as commands
          break;
      }
    }

    _send(msg) {
      if (this._ws && this._ws.readyState === 1 /* OPEN */) {
        try {
          this._ws.send(JSON.stringify(msg));
          this._log('→', msg.type, msg);
        } catch (e) {
          this._log('Send error', e);
          this.emit('error', e);
        }
      } else {
        // Queue non-ping/pong messages for when we reconnect
        if (msg.type !== 'ping' && msg.type !== 'pong' && msg.type !== 'ack') {
          this._msgQueue.push(msg);
        }
      }
    }

    _sendWithAck(msg) {
      return new Promise((resolve, reject) => {
        const mid = msg.message_id;
        const timer = setTimeout(() => {
          if (this._pendingAcks[mid]) {
            delete this._pendingAcks[mid];
            reject(new Error(`Ack timeout for message ${mid}`));
          }
        }, ACK_TIMEOUT);
        this._pendingAcks[mid] = { resolve, reject, timer };
        this._send(msg);
      });
    }

    _scheduleReconnect() {
      const delay = this._reconnectDelay;
      this._log(`Reconnecting in ${delay}ms…`);
      this._reconnectTimer = setTimeout(() => this._openWs(), delay);
      this._reconnectDelay = Math.min(this._reconnectDelay * RECONNECT_FACTOR, MAX_RECONNECT_DELAY);
    }

    _clearTimers() {
      if (this._pingTimer)      { clearInterval(this._pingTimer);    this._pingTimer = null; }
      if (this._pongTimer)      { clearTimeout(this._pongTimer);     this._pongTimer = null; }
      if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    }

    _rejectAllAcks(err) {
      Object.values(this._pendingAcks).forEach(({ reject, timer }) => {
        clearTimeout(timer);
        reject(err);
      });
      this._pendingAcks = {};
    }

    _genId() {
      return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    _log(...args) {
      if (this._debug) console.log('[arc-sdk]', ...args);
    }
  }

  return { ArcSatelliteClient };
});
