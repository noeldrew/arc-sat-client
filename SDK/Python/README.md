# ARC Satellite SDK for Python

Reusable Python port of the ARC Satellite SDK used by ARC-connected games and
interactive applications.

## Compatibility

- Python 3.9 or newer
- Windows, macOS and Linux
- Asyncio-based applications
- `websockets` 12–16

## Install

Unzip the download, open a terminal in the extracted folder, and run:

```bash
python -m pip install .
```

For editable development:

```bash
python -m pip install -e .
```

## Minimal setup

```python
import asyncio

from arc_satellite import ArcSatelliteClient, SatelliteOptions


async def main():
    client = ArcSatelliteClient(SatelliteOptions(
        app_name="My Game",
        app_version="1.0.0",
    ))

    @client.event("session-start")
    async def on_session_start(event):
        customer = event.customer or {}
        name = (
            customer.get("display_name")
            or customer.get("first_name")
            or "Player"
        )
        print(f"Welcome {name}")
        await client.send_trigger("game-started")

    @client.event("session-end")
    async def on_session_end(event):
        print("Return to the holding screen")

    await client.run_forever()


asyncio.run(main())
```

Connecting to the server never starts gameplay. Your application must remain on
its holding screen until the SDK emits `session-start`.

## Registering triggers

```python
from arc_satellite import SatelliteOptions, TriggerDefinition

options = SatelliteOptions(triggers=[
    TriggerDefinition("game-started", "Game Started"),
    TriggerDefinition("level-1-complete", "Level 1 Complete"),
    TriggerDefinition("game-complete", "Game Complete"),
])
```

Definitions are included in `hello`. You can also register them later:

```python
await client.register_triggers([
    TriggerDefinition("bonus-found", "Bonus Found"),
])
```

## Sending triggers

```python
await client.send_trigger("game-started")

await client.send_trigger("level-1-complete", {
    "target_gems": 12,
    "gems_collected": 14,
})
```

To await an ARC acknowledgement:

```python
ack = await client.send_trigger_with_ack("game-complete")
```

## Session IDs

When a valid `session-start` arrives, the SDK:

1. reads `session_id` from the top-level message or `payload.session_id`;
2. stores the session ID and customer;
3. invokes your `session-start` handler;
4. sends `session-started`; and
5. acknowledges the incoming message when it has a `message_id`.

The ID is deliberately stored before step 3. A trigger sent from your
`session-start` handler therefore contains that exact ID as a top-level
`session_id`.

All session-bound triggers, messages and UGC uploads automatically receive the
current top-level `session_id`.

## Ending a session

For an app-initiated end:

```python
await client.close_session()
```

This sends `close-session` with the stored session ID and clears local session
state.

If the server sends `session-end`, the SDK clears its state, emits
`session-end`, and sends `session-ended`. Do not call `close_session()` from
that event handler.

## Events

| Wire event | Python event |
|---|---|
| `open` | `open` |
| `close` | `close` |
| `error` | `error` |
| `session-start` | `session-start` |
| `session-end` | `session-end` |
| `command` | `command` |
| every valid message | `message` |
| `content` | `content` |
| `ack` | `ack` |

Handlers can be synchronous or asynchronous:

```python
client.on("command", my_handler)

@client.event("content")
async def content_received(payload):
    ...
```

## Protocol behaviour

The Python implementation preserves:

- `ws://localhost:25585` defaults;
- trigger definitions in `hello`;
- dynamic `register-triggers`;
- outbound queuing while disconnected;
- 25-second application pings and 10-second pong deadlines;
- 2-second exponential reconnect delay at factor 1.5, capped at 30 seconds;
- a fixed 30-second reconnect delay after a pong timeout;
- 8-second acknowledgement timeouts;
- automatic `session-started`, `session-ended`, command/content receipts;
- current session and customer tracking;
- unknown inbound types forwarded as commands; and
- URL or base64 UGC upload messages.

## Debug logging

Debug output is disabled by default. Enable it when diagnosing integration:

```python
import logging

logging.basicConfig(level=logging.INFO)
client = ArcSatelliteClient(SatelliteOptions(debug=True))
```

This logs raw inbound and outbound JSON, including:

```text
Session stored: session_id=<id>
Session attached: type=trigger, session_id=<id>
```

Disable debug logging in production if payloads may contain customer data.

## Example

Run the complete sample after installation:

```bash
python examples/session_game.py
```
