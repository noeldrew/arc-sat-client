using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Arc.Satellite
{
    [Serializable]
    public sealed class ArcTriggerDefinition
    {
        [JsonProperty("id")]
        public string Id;

        [JsonProperty("name")]
        public string Name;

        [JsonProperty("description", NullValueHandling = NullValueHandling.Ignore)]
        public string Description;

        public ArcTriggerDefinition() { }

        public ArcTriggerDefinition(string id, string name, string description = null)
        {
            Id = id;
            Name = name;
            Description = description;
        }
    }

    public sealed class ArcSatelliteOptions
    {
        public string Host { get; set; } = "localhost";
        public int Port { get; set; } = 25585;
        public string AppName { get; set; } = "Local App";
        public string AppVersion { get; set; } = "1.0.0";
        public bool AutoReconnect { get; set; } = true;
        public TimeSpan ReconnectDelay { get; set; } = TimeSpan.FromSeconds(2);
        public TimeSpan MaximumReconnectDelay { get; set; } = TimeSpan.FromSeconds(30);
        public double ReconnectFactor { get; set; } = 1.5;
        public TimeSpan PingInterval { get; set; } = TimeSpan.FromSeconds(25);
        public TimeSpan PongTimeout { get; set; } = TimeSpan.FromSeconds(10);
        public TimeSpan AckTimeout { get; set; } = TimeSpan.FromSeconds(8);
        public bool Debug { get; set; }
        public IReadOnlyList<ArcTriggerDefinition> Triggers { get; set; } =
            Array.Empty<ArcTriggerDefinition>();

        public Uri WebSocketUri => new Uri($"ws://{Host}:{Port}");
    }

    public sealed class ArcSessionStartEvent
    {
        public string SessionId { get; internal set; }
        public JObject Customer { get; internal set; }
        public string Action { get; internal set; }
        public JToken Payload { get; internal set; }
        public JObject RawMessage { get; internal set; }
    }

    public sealed class ArcSessionEndEvent
    {
        public string SessionId { get; internal set; }
        public JObject RawMessage { get; internal set; }
    }

    public sealed class ArcCloseInfo
    {
        public int? Code { get; internal set; }
        public string Reason { get; internal set; }
        public bool WasIntentional { get; internal set; }
    }
}
