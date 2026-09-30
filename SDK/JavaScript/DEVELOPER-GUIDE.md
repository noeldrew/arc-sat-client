# Arc Satellite SDK — Developer Guide

> Version 1.1.0 · ARC Client satellite integration SDK

Maintained in the [ARC Client repository](https://github.com/noeldrew/arc-sat-client/tree/dev/SDK), alongside the Python and Unity/C# satellite SDKs. These packages connect local applications to ARC Client; they are separate from the ARC server SDK suite.

This guide explains how to connect your local venue application to the standalone **ARC Client** running on the same machine, so that it can receive player sessions, send trigger events, upload content, and interact with the Arc loyalty and ticketing platform.

---

## Table of Contents

1. [What is the ARC Client?](#1-what-is-the-arc-client)
2. [Quick Start](#2-quick-start)
3. [Installation](#3-installation)
4. [Connection Protocol](#4-connection-protocol)
5. [SDK Reference](#5-sdk-reference)
6. [Message Reference](#6-message-reference)
7. [Session Lifecycle](#7-session-lifecycle)
8. [Triggers](#8-triggers)
9. [Uploading Content](#9-uploading-content)
10. [Customer Object Reference](#10-customer-object-reference)
11. [Direct WebSocket Integration](#11-direct-websocket-integration)
12. [HTTP REST Transport](#12-http-rest-transport)
13. [App Launcher Integration](#13-app-launcher-integration)
14. [System Alerts](#14-system-alerts)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. What is the ARC Client?

The standalone **ARC Client** is a lightweight desktop application that runs on every attraction PC or kiosk in your venue. It:

- Maintains a persistent WebSocket connection to the Arc cloud server
- Exposes **local transports** (WebSocket, HTTP, TCP, UDP) so that your attraction software can communicate with Arc without needing internet access or API keys
- Handles authentication, reconnection, session routing, and loyalty events on your behalf

Your application — be it a game, photo booth, interactive experience, or kiosk — communicates **only** with the ARC Client. The client handles everything else.

```
┌──────────────────┐    WebSocket/HTTP    ┌─────────────────────┐    WSS    ┌──────────────┐
│  Your Local App  │ ───────────────────► │  Arc Satellite      │ ────────► │  Arc Cloud   │
│  (this SDK)      │ ◄─────────────────── │  Client (port 25585)│ ◄──────── │  Server      │
└──────────────────┘                      └─────────────────────┘           └──────────────┘
```

---

## 2. Quick Start

```html
<!DOCTYPE html>
<html>
<head><title>My Attraction</title></head>
<body>
<script type="module">
import { ArcSatelliteClient } from './sdk/arc-satellite-sdk.js';

const arc = new ArcSatelliteClient({ debug: true });

arc.on('session-start', ({ customer }) => {
  // The SDK automatically stores the session ID — you don't need to track it.
  console.log('Player arrived!', customer.display_name);
  document.getElementById('greeting').textContent = `Welcome, ${customer.first_name}!`;
  document.getElementById('points').textContent = customer.loyalty?.points_label ?? '—';
});

arc.on('session-end', () => {
  document.getElementById('greeting').textContent = 'Scan your wristband to start!';
});

arc.connect();

// When the player finishes the game — session_id is attached automatically:
function onGameComplete(score) {
  arc.sendTrigger('game-completed', { score });
  arc.sendScore(score, { level: 5, time_seconds: 124 });
}
</script>

<h1 id="greeting">Scan your wristband to start!</h1>
<p>Your Arc points: <strong id="points">—</strong></p>
</body>
</html>
```

> **You never pass `session_id` yourself.** The SDK captures it when a session starts and appends it to every outgoing message automatically.

---

## 3. Installation

### Browser (ES Module)

Copy `arc-satellite-sdk.js` into your project directory and import it:

```js
import { ArcSatelliteClient } from './sdk/arc-satellite-sdk.js';
```

### Node.js

```js
const { ArcSatelliteClient } = require('./arc-satellite-sdk.js');
// Also install the ws package: npm install ws
```

### CDN / Inline script

```html
<script src="./sdk/arc-satellite-sdk.js"></script>
<script>
  const arc = new ArcSatelliteSDK.ArcSatelliteClient();
  arc.connect();
</script>
```

---

## 4. Connection Protocol

The ARC Client exposes a local WebSocket server on **`ws://localhost:25585`** by default. The port is configurable in the ARC Client settings.

### Handshake

When your application opens a WebSocket connection, send a `hello` message immediately:

```json
{ "type": "hello", "app": "My Game", "version": "1.2.0" }
```

The Satellite will reply with an `ack`:

```json
{ "type": "ack", "status": "ok", "session_id": null }
```

If a player session is already active at the time of connection, the Satellite will immediately send a `session-start` message.

### Keep-alive

Send a `ping` every 25 seconds; the Satellite will reply with a `pong`:

```json
{ "type": "ping" }   →   { "type": "pong" }
```

The SDK handles this automatically.

---

## 5. SDK Reference

### Constructor

```js
const arc = new ArcSatelliteClient(options);
```

| Option          | Type    | Default        | Description                                         |
|-----------------|---------|----------------|-----------------------------------------------------|
| `host`          | string  | `'localhost'`  | Satellite host                                      |
| `port`          | number  | `25585`        | Satellite WebSocket port                            |
| `appName`       | string  | `'Local App'`  | Your app's name (sent in hello)                     |
| `appVersion`    | string  | `'1.0.0'`      | Your app's version (sent in hello)                  |
| `autoReconnect` | boolean | `true`         | Automatically reconnect on drop                     |
| `pingInterval`  | number  | `25000`        | ms between keep-alive pings sent to the Satellite; set to `0` to disable |
| `debug`         | boolean | `false`        | Log all messages to console                         |

### Methods

#### `arc.connect()`
Open the WebSocket connection. Safe to call multiple times.

#### `arc.disconnect()`
Close the connection. No further reconnect attempts will be made.

#### `arc.sendTrigger(triggerId, payload?, options?)`
Fire a trigger event at the Arc server. The current session ID is attached automatically.

```js
arc.sendTrigger('game-completed', { score: 9850, level: 4 });

// With acknowledgement:
const result = await arc.sendTrigger('game-completed', { score: 9850 }, { awaitAck: true });
```

| Parameter  | Type   | Description                                   |
|------------|--------|-----------------------------------------------|
| triggerId  | string | The trigger ID (configured in Satellite UI)   |
| payload    | object | Any extra data to include                     |
| options    | object | `{ awaitAck: boolean }` — wait for server ack |

#### `arc.sendScore(score, metadata?)`
Shorthand for `sendTrigger('score-achieved', { score, ...metadata })`.

```js
arc.sendScore(14250, { level: 7, time_seconds: 98, combo: 'x4' });
```

#### `arc.sendMessage(type, payload?)`
Send any typed message to the Arc server via the Satellite. The current session ID is attached automatically.

```js
arc.sendMessage('door-opened', { door_id: 'exit-left' });
```

#### `arc.sendContent(data, mimeType?, meta?)`
Upload user-generated content (photo, screenshot, video clip). Returns a Promise. The current session ID is attached automatically.

```js
// From a canvas element:
canvas.toBlob(async (blob) => {
  const result = await arc.sendContent(blob, 'image/jpeg', {
    label: 'Finish line photo',
    player_name: arc.customer?.display_name,
  });
  console.log('Uploaded:', result.url);
}, 'image/jpeg', 0.9);

// From a URL:
await arc.sendContent('https://cdn.mygame.com/screenshot/abc.jpg', 'image/jpeg');
```

#### `arc.confirmReceipt(messageId)`
Manually acknowledge a message from the server (the SDK does this automatically for `session-start`, `command`, and `content` messages).

#### `arc.closeSession()`
Notify the Satellite that the player's session has ended from your app's perspective.

### Properties

| Property            | Type     | Description                                                         |
|---------------------|----------|---------------------------------------------------------------------|
| `arc.connected`     | boolean  | Whether the WebSocket is currently open                             |
| `arc.sessionId`     | string\|null | The current Arc session ID — managed automatically by the SDK  |
| `arc.customer`      | object\|null | The current customer object — set on `session-start`, cleared on `session-end` |
| `arc.wsUrl`         | string   | The WebSocket URL being used                                        |

### Events

Use `arc.on(event, handler)` to listen for events. Use `arc.once(event, handler)` for one-time handlers.

| Event          | Payload                                  | Description                                      |
|----------------|------------------------------------------|--------------------------------------------------|
| `open`         | —                                        | WebSocket connected                              |
| `close`        | CloseEvent                               | WebSocket disconnected                           |
| `error`        | Error                                    | WebSocket or protocol error                      |
| `session-start`| `{ session_id, customer, action, payload }` | A player session has started; `action`/`payload` set when triggered by a command (e.g. an RFID tap) |
| `session-end`  | `{ session_id }`                         | The player session has ended                     |
| `command`      | message object                           | A command from the Arc server                    |
| `content`      | payload object                           | Content delivery from Arc                        |
| `ack`          | message object                           | The server acknowledged a message                |
| `message`      | message object                           | Any inbound message (before event routing)       |

---

## 6. Message Reference

### Naming conventions

All wire messages follow two rules:

| Element | Convention | Example |
|---------|-----------|---------|
| JSON property names | `snake_case` | `session_id`, `trigger_id`, `mime_type` |
| Message `type` values | `kebab-case` | `session-start`, `session-end`, `ugc-upload`, `close-session` |

### Messages you send

> **Note:** When using the SDK, you never set `session_id` yourself — it is injected automatically on every outbound message while a session is active. The fields below describe the underlying wire protocol.

| Type            | Fields                                       | Description                                      |
|-----------------|----------------------------------------------|--------------------------------------------------|
| `hello`         | `app`, `version`                             | Announce your app on connection                  |
| `ping`          | —                                            | Keep-alive (SDK sends automatically)             |
| `trigger`       | `trigger_id`, `payload`, [`session_id`]      | Fire a trigger event — session_id auto-injected  |
| `ugc-upload`    | `data` (base64) or `url`, `mime_type`, `meta`| Upload user content — session_id auto-injected   |
| `ack`           | `message_id`                                 | Acknowledge a received message                   |
| `session-started` | `session_id`                               | Acknowledge a cloud-initiated session start (SDK sends automatically) |
| `session-ended` | `session_id`                                 | Acknowledge a cloud-initiated session end (SDK sends automatically) |
| `close-session` | `session_id`                                 | End the session from the app side (app-initiated) |

### Messages you receive

| Type             | Key Fields                                   | Description                              |
|------------------|----------------------------------------------|------------------------------------------|
| `ack`            | `status`, `message_id`                       | Acknowledgement from server              |
| `pong`           | —                                            | Keep-alive reply                         |
| `session-start`  | `session_id`, `customer`                     | Player arrived (wristband tapped)        |
| `session-end`    | `session_id`                                 | Player left / session timed out — SDK auto-replies with `session-ended` |
| `command`        | `action`, `payload`                          | Instruction from the Arc server          |
| `content`        | `url`, `type`, `meta`                        | Content delivery (image, video, data)    |
| `error`          | `code`, `message`                            | Error from the Arc server                |

---

## 7. Session Lifecycle

A **session** represents one player's visit to your attraction. It begins when the player taps their wristband on the RFID reader and ends when they leave or a timeout occurs.

### Session ID is fully automatic

> **The SDK handles all session ID management for you.**
>
> - When a `session-start` message arrives, the SDK stores the session ID internally.
> - Every call to `sendTrigger()`, `sendMessage()`, `sendContent()`, and `closeSession()` automatically includes the stored session ID on the wire.
> - When the session ends, the SDK clears the stored ID.
>
> **You never read, store, or pass `session_id` yourself.** If you need to inspect it (e.g. for logging), it is available as `arc.sessionId`.

```
Player taps wristband
        │
        ▼
Satellite receives session-start from Arc server
        │
        ▼
SDK stores session ID internally, emits 'session-start' event
        │
        ▼
Your app starts the experience, greets the player, loads loyalty points…
        │   (call sendTrigger / sendScore freely — session_id is automatic)
        ▼
Player leaves / session times out
        │
        ▼
SDK clears session ID, emits 'session-end' event
        │
        ▼
Your app resets to attract screen
```

### Example — minimal session handler

```js
const arc = new ArcSatelliteClient();

arc.on('session-start', ({ customer }) => {
  showWelcomeScreen(customer.first_name, customer.loyalty.points_balance);
});

arc.on('session-end', () => {
  showAttractScreen();
});

arc.connect();

// Anywhere in your game code — no session_id needed:
function onGameOver(score) {
  arc.sendTrigger('game-completed', { score });
}
```

### Multiple sessions without reconnecting

Your app may stay connected to the Satellite across many player sessions. The same WebSocket connection is reused — you don't need to disconnect and reconnect between players.

### Handling a session that starts before you connect

If a player's session is already active when your app opens its WebSocket, the Satellite will immediately send a `session-start` message after the `hello` handshake. The SDK stores the session ID and your `session-start` handler fires as normal.

---

## 8. Triggers

Triggers are named events that your attraction fires when something notable happens. You define triggers in the ARC Client's **Trigger Events** page or in the Arc Admin Portal.

**Common triggers:**

| ID                | When to fire                                   |
|-------------------|------------------------------------------------|
| `game-started`    | Player begins gameplay                          |
| `game-completed`  | Player finishes the game                        |
| `score-achieved`  | Player reaches a notable score                  |
| `photo-taken`     | A photo was captured                            |
| `door-opened`     | A physical door/gate opened                     |
| `rfid-scanned`    | An RFID wristband was scanned locally           |

**Firing a trigger with payload:**

```js
arc.sendTrigger('game-completed', {
  score: 14250,
  rank: 'S',
  time_seconds: 187,
  level_reached: 9,
});
// session_id is appended automatically — no extra work needed.
```

The payload is stored with the loyalty event and can be used in loyalty rules (e.g., "award 10 points per 1,000 score points").

---

## 9. Uploading Content

### Photo upload (from a canvas)

```js
function captureAndUpload() {
  const canvas = document.getElementById('game-canvas');
  canvas.toBlob(async (blob) => {
    try {
      const result = await arc.sendContent(blob, 'image/jpeg', {
        label: 'Results screen',
        score: currentScore,
      });
      // result.url is the hosted photo URL — you can display it
      showQrCode(result.url);
    } catch (e) {
      console.error('Upload failed', e);
    }
  }, 'image/jpeg', 0.85);
}
```

### Video clip upload (from Blob)

```js
mediaRecorder.onstop = async () => {
  const blob = new Blob(chunks, { type: 'video/webm' });
  const result = await arc.sendContent(blob, 'video/webm', {
    label: 'Gameplay highlight',
    duration_seconds: 15,
  });
  console.log('Video hosted at:', result.url);
};
```

---

## 10. Customer Object Reference

The `customer` field in `session-start` follows this structure. See `customer-example.json` for a complete example.

```
customer
├── id                        string    Arc customer ID
├── first_name                string
├── last_name                 string
├── display_name              string    Formatted short name
├── email                     string?
├── avatar_url                string?   Profile image URL
├── locale                    string    e.g. "en-GB"
├── wristband
│   ├── uid                   string    RFID UID (hex)
│   ├── status                string    "active" | "expired" | "voided"
│   ├── wallet_balance_pence  number    Balance in lowest currency unit
│   ├── wallet_balance_formatted string  e.g. "£24.00"
│   ├── pass_type             string    e.g. "day_pass", "vip"
│   ├── zone_access           string[]  Allowed zones
│   └── expires_at            string    ISO 8601 datetime
├── loyalty
│   ├── tier                  string    "bronze" | "silver" | "gold" | "platinum"
│   ├── points_balance        number
│   ├── points_to_next_tier   number
│   ├── tier_progress_percent number    0–100
│   └── unrevealed_rewards    number    Scratchcard-style pending rewards
├── booking
│   ├── order_reference       string    Human-readable ref e.g. "ARC-20726-HJKL"
│   ├── ticket_type           string
│   ├── session_name          string
│   ├── session_start         string    ISO 8601 datetime
│   ├── session_end           string    ISO 8601 datetime
│   └── add_ons               array     Purchased add-ons
└── custom_fields             object    Venue-defined extra fields
```

---

## 11. Direct WebSocket Integration

> **This section describes the raw wire protocol.** If you use the JavaScript SDK, you do not need to read or manage `session_id` at all — skip to [Section 7](#7-session-lifecycle).
>
> The examples below show what the SDK does internally, and are intended for developers building their own integration in Python, C#, Unity, or another language that doesn't yet have an Arc SDK.

If you prefer not to use the SDK, you can communicate directly over WebSocket. All messages are JSON. Your integration is responsible for:

- Sending `hello` on connect
- Storing the `session_id` from every `session-start` message
- Appending that `session_id` to every trigger/message you send while the session is active
- Clearing the stored `session_id` when `session-end` arrives

```python
# Python example (asyncio + websockets)
import asyncio, json, websockets

async def main():
    session_id = None  # your code must track this

    async with websockets.connect('ws://localhost:25585') as ws:
        await ws.send(json.dumps({'type': 'hello', 'app': 'Python Game', 'version': '1.0'}))

        async for raw in ws:
            msg = json.loads(raw)

            if msg['type'] == 'session-start':
                session_id = msg['session_id']   # store it
                customer = msg.get('customer', {})
                print(f"Player arrived: {customer.get('display_name')}")

            elif msg['type'] == 'session-end':
                session_id = None               # clear it

            # Fire trigger — include session_id if a session is active
            if some_game_event:
                await ws.send(json.dumps({
                    'type': 'trigger',
                    'trigger_id': 'game-completed',
                    'payload': {'score': 5000},
                    **(({'session_id': session_id}) if session_id else {}),
                }))

asyncio.run(main())
```

```csharp
// C# example (using System.Net.WebSockets)
using var ws = new ClientWebSocket();
await ws.ConnectAsync(new Uri("ws://localhost:25585"), CancellationToken.None);

var hello = JsonSerializer.Serialize(new { type = "hello", app = "Unity Game", version = "1.0" });
await ws.SendAsync(Encoding.UTF8.GetBytes(hello), WebSocketMessageType.Text, true, ct);

// Your code must track sessionId and append it to outgoing messages.
string? sessionId = null;
```

> **Tip:** If you're building a reusable integration for a non-JS platform, follow the same pattern as the JS SDK — store the session ID on `session-start`, spread it into every outgoing message, and clear it on `session-end`. This keeps application code clean and free of session management.

---

## 12. HTTP REST Transport

For simple fire-and-forget scenarios, the Satellite also exposes a local HTTP server on **`http://localhost:25586`**.

> The session ID is resolved server-side from the active session — you don't need to include it in HTTP calls.

### POST `/trigger`

Fire a trigger event:

```bash
curl -X POST http://localhost:25586/trigger \
  -H 'Content-Type: application/json' \
  -d '{"trigger_id": "game-completed", "payload": {"score": 9500}}'
```

Response:
```json
{ "ok": true, "queued": true }
```

### GET `/session`

Get the current player session:

```bash
curl http://localhost:25586/session
```

Response:
```json
{
  "active": true,
  "session_id": "ws_sess_01HXYZ…",
  "customer": { "display_name": "Jamie A.", "loyalty": { "points_balance": 4750 } }
}
```

### GET `/status`

Check Satellite connection status:

```bash
curl http://localhost:25586/status
```

Response:
```json
{
  "server_connected": true,
  "local_session_active": true,
  "client_id": "SAT-66413E",
  "version": "2.0.0"
}
```

---

## 13. App Launcher Integration

The ARC Client can **automatically launch your application** when it connects to the Arc server, removing the need for manual startup procedures.

### Setting it up

1. Open the ARC Client on the machine
2. Navigate to **App Launcher** in the left sidebar
3. Either:
   - **Drag your app shortcut** (`.lnk`, `.desktop`, `.exe`, `.html`) onto the drop zone, or
   - Click **Browse…** to select the file
   - Paste a **Bash script** into the script editor for complex startup sequences
4. Tick **"Auto-launch when connected to Arc server"**
5. Click **Save Options**

### Startup script example

```bash
#!/bin/bash
# Set display for headless setups
export DISPLAY=:0

# Start the game in full-screen
/opt/mygame/game --fullscreen --satellite-port 25585 &
GAME_PID=$!

# Wait for it to be ready, then notify
sleep 3
curl -s -X POST http://localhost:25586/trigger \
  -H 'Content-Type: application/json' \
  -d '{"trigger_id": "app-started"}'

echo "Game started (PID $GAME_PID)"
```

---

## 14. System Alerts

The Satellite monitors system resources and configured processes. If a monitored process stops unexpectedly, the Satellite sends a `system_alert` message to the Arc server — this appears in the venue's admin dashboard.

### Configure monitored processes

1. Navigate to **System Monitor** in the ARC Client
2. Enter the process name (e.g., `chrome.exe`, `mygame`, `kiosk`)
3. Click **Add**

### System alert payload (server receives)

```json
{
  "type": "system_alert",
  "client_id": "SAT-66413E",
  "process": "mygame",
  "status": "stopped",
  "timestamp": "2026-07-25T14:23:45Z"
}
```

---

## 15. Troubleshooting

### Cannot connect to ws://localhost:25585

1. Confirm the ARC Client is running on this machine
2. Check **Settings → Local WebSocket Port** — the default is 25585
3. Ensure no firewall rule blocks local loopback connections
4. Try `curl http://localhost:25586/status` to confirm the HTTP transport is live

### Session start never fires

1. Check the ARC Client's **Activity Log** — do you see `session-start` messages with direction "SERVER"?
2. If yes, the satellite received it but your connection may have opened after it arrived — send `{ "type": "hello" }` and wait; the Satellite will replay active sessions
3. If no entries in the Activity Log, the Satellite may not be registered. Check **Settings → Server URL** and API token

### Triggers are not saving to loyalty

1. Confirm the `trigger_id` matches exactly what's configured in the Arc Admin Portal trigger library (case-sensitive)
2. Check that a loyalty earning rule references the trigger
3. View the **Activity Log** to confirm the trigger reached the server (look for `outbound` entries)

### Upload (sendContent) times out

1. The satellite proxies uploads — the Arc server must be reachable
2. Check the ARC Client's server connection status (green dot in the sidebar)
3. For large files (>5 MB), prefer passing a URL to a CDN rather than binary payload

---

*For further help, consult the Arc Admin Portal → Developer section, or contact your Arc platform representative.*
