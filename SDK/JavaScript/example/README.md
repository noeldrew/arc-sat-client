# Arc Satellite SDK — Node.js Example

A minimal Node.js script that connects to the standalone ARC Client and demonstrates the full session lifecycle: greeting a player when their wristband is tapped, firing a game trigger mid-session, and resetting when they leave.

---

## Prerequisites

- **Node.js** 18 or newer ([nodejs.org](https://nodejs.org))
- The standalone **ARC Client** running on the same machine (or reachable on your network)

---

## Setup

1. **Install the one required package** (`ws` — WebSocket support for Node.js):

   ```bash
   cd SDK/JavaScript/example
   npm install
   ```

   This reads `package.json` and installs `ws` into a local `node_modules/` folder.

2. **Make sure the standalone ARC Client is running.**
   By default it listens on port **25585**. If you've changed the port in the ARC Client settings, update the `port` option near the top of `example.js`.

---

## Run

```bash
node example.js
```

You should see:

```
[arc] Connected to Satellite at ws://localhost:25585
[arc] Waiting for a player to tap their wristband…
```

Now tap a wristband on the RFID reader (or trigger a test session from the Arc Admin Portal). The script will print the player's name and loyalty tier, simulate a 3-second game, fire a `game-completed` trigger with a random score, and then wait for the next player.

---

## What the example covers

| Feature | Where in example.js |
|---|---|
| Connecting to the Satellite | `arc.connect()` |
| Greeting a player on session start | `arc.on('session-start', ...)` |
| Reading customer name & loyalty points | `customer.display_name`, `customer.loyalty` |
| Resetting on session end | `arc.on('session-end', ...)` |
| Receiving server commands | `arc.on('command', ...)` |
| Firing a trigger (e.g. score) | `arc.sendTrigger('game-completed', { score })` |
| Automatic reconnection | built into the SDK — no extra code needed |

---

## File layout

```
sdk/
├── arc-satellite-sdk.js      ← the SDK (don't modify)
├── DEVELOPER-GUIDE.md        ← full API reference
├── customer-example.json     ← shape of the customer object
└── example/
    ├── example.js            ← this example script
    ├── package.json          ← declares the ws dependency
    └── README.md             ← you are here
```

---

## Customising

Open `example.js` and edit the `simulateGame()` function — replace the `setTimeout` block with your real game logic. Everything else (connection, session handling, trigger sending) stays the same.

For the full API — all methods, events, and options — see [`../DEVELOPER-GUIDE.md`](../DEVELOPER-GUIDE.md).
