using System;
using System.Collections.Generic;
using UnityEngine;

namespace Arc.Satellite
{
    /// <summary>
    /// Unity lifecycle wrapper. Add this component once in the initial scene
    /// and subscribe to Client events from your game controller.
    /// </summary>
    [DefaultExecutionOrder(-1000)]
    public sealed class ArcSatelliteBehaviour : MonoBehaviour
    {
        [Header("Satellite")]
        [SerializeField] private string host = "localhost";
        [SerializeField] private int port = 25585;
        [SerializeField] private bool connectOnStart = true;
        [SerializeField] private bool autoReconnect = true;
        [SerializeField] private bool debugMessages;

        [Header("Application")]
        [SerializeField] private string appName = "Unity Game";
        [SerializeField] private string appVersion = "1.0.0";
        [SerializeField] private List<ArcTriggerDefinition> triggers =
            new List<ArcTriggerDefinition>();

        [Header("Timing (seconds)")]
        [SerializeField] private float pingInterval = 25f;
        [SerializeField] private float pongTimeout = 10f;
        [SerializeField] private float acknowledgementTimeout = 8f;

        public ArcSatelliteClient Client { get; private set; }

        private void Awake()
        {
            Client = new ArcSatelliteClient(new ArcSatelliteOptions
            {
                Host = host,
                Port = port,
                AppName = appName,
                AppVersion = appVersion,
                AutoReconnect = autoReconnect,
                PingInterval = TimeSpan.FromSeconds(Mathf.Max(0f, pingInterval)),
                PongTimeout = TimeSpan.FromSeconds(Mathf.Max(0f, pongTimeout)),
                AckTimeout = TimeSpan.FromSeconds(Mathf.Max(0.1f, acknowledgementTimeout)),
                Debug = debugMessages,
                Triggers = triggers
            });
        }

        private void Start()
        {
            if (connectOnStart)
                Client.Connect();
        }

        private void Update()
        {
            Client?.DispatchEvents();
        }

        private async void OnApplicationQuit()
        {
            if (Client == null)
                return;
            try { await Client.DisconnectAsync(); }
            catch { }
        }

        private void OnDestroy()
        {
            Client?.Dispose();
            Client = null;
        }
    }
}
