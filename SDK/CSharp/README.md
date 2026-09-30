# ARC Satellite SDK for Unity

Unity C# port of the finished ARC Satellite JavaScript SDK.

## Compatibility

- Unity 6.0 or newer
- macOS and Windows desktop players
- Unity Editor
- Not WebGL (`ClientWebSocket` is not available there in the same form)

The package uses Unity's official Newtonsoft JSON package, declared as a package
dependency.

## Install

1. Unzip this package somewhere stable.
2. In Unity, open **Window > Package Manager**.
3. Choose **+ > Add package from disk...**
4. Select this package's `package.json`.

Alternatively, copy the folder into your project's `Packages` directory and
rename it to `com.arc.satellite-sdk`.

## Scene setup

1. Create a GameObject named `ARC Satellite`.
2. Add `ArcSatelliteBehaviour`.
3. Set the app name/version and add every trigger definition in the Inspector.
4. Add a game controller and subscribe to `satellite.Client` events.
5. Keep the game on its holding screen until `SessionStarted` is raised.

`ArcSatelliteBehaviour` automatically connects and dispatches all callbacks on
Unity's main thread. If using `ArcSatelliteClient` directly, call
`DispatchEvents()` from `Update()`.

## Canonical event mapping

| JavaScript SDK event | Unity C# event |
|---|---|
| `open` | `Opened` |
| `close` | `Closed` |
| `error` | `Error` |
| `session-start` | `SessionStarted` |
| `session-end` | `SessionEnded` |
| `command` | `CommandReceived` |
| `message` | `MessageReceived` |
| `content` | `ContentReceived` |
| `ack` | `Acknowledged` |

Wire message names remain unchanged and lowercase/hyphenated.

## Session-start example

```csharp
private void OnEnable()
{
    satellite.Client.SessionStarted += OnSessionStarted;
    satellite.Client.SessionEnded += OnSessionEnded;
}

private void OnSessionStarted(ArcSessionStartEvent message)
{
    var name =
        message.Customer?.Value<string>("display_name") ??
        message.Customer?.Value<string>("first_name") ??
        "Player";

    ShowWelcome(name);
}

private void OnSessionEnded(ArcSessionEndEvent message)
{
    StopGameImmediately();
    ShowHoldingScreen();
}
```

Socket connection alone must never start gameplay.

## Sending triggers

```csharp
satellite.Client.SendTrigger("game-started");

satellite.Client.SendTrigger(
    "level-1-complete",
    new JObject
    {
        ["target_gems"] = 12,
        ["gems_collected"] = 14
    });
```

To await the Satellite acknowledgement:

```csharp
JObject acknowledgement =
    await satellite.Client.SendTriggerAsync("game-complete");
```

## Ending a session

For an app-initiated end:

```csharp
satellite.Client.CloseSession();
```

For an external `session-end`, the SDK clears its session state, raises
`SessionEnded`, and automatically sends `session-ended`. Do not call
`CloseSession()` in response to `SessionEnded`.

## Protocol parity

The C# implementation preserves:

- `ws://localhost:25585` defaults;
- trigger definitions in `hello`;
- dynamic `register-triggers`;
- outbound queuing while disconnected;
- 25-second pings and 10-second pong deadlines;
- 2-second exponential reconnect backoff at factor 1.5, capped at 30 seconds;
- a fixed 30-second delay after a pong timeout;
- 8-second acknowledgement timeouts;
- automatic `session-started`, `session-ended`, command/content receipts;
- current session/customer tracking;
- `action` and original `payload` on `SessionStarted`;
- unknown inbound types forwarded as commands; and
- URL or base64 UGC upload messages.

## Important threading rule

Unity APIs may only be used on Unity's main thread. Socket work happens
asynchronously, but all public SDK events are queued. `ArcSatelliteBehaviour`
calls `DispatchEvents()` in `Update()`, so game event handlers are safe to use
with Unity objects.

## Debugging

Enable **Debug Messages** on `ArcSatelliteBehaviour` to print raw inbound and
outbound JSON. It is disabled by default for reusable/production integrations.

When a session begins, the log shows:

```text
[arc-sdk] Session stored: session_id=<id>
[arc-sdk] Session attached: type=trigger, session_id=<id>
```

The SDK stores the received ID before raising `SessionStarted`. Consequently,
a trigger sent by the game inside its `SessionStarted` handler already contains
the same ID as a top-level `session_id` property.
