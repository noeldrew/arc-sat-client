/**
 * Arc Satellite SDK — Node.js Example
 * ─────────────────────────────────────
 * A minimal script that connects to the standalone ARC Client,
 * greets each player when their session starts, fires a trigger
 * mid-game, and resets when the session ends.
 *
 * Run:  node example.js
 */

'use strict';

// ── 1. Polyfill WebSocket for Node.js ─────────────────────────────────────────
//
// The SDK is designed for browsers, where WebSocket is a built-in global.
// In Node.js we provide it using the `ws` package before requiring the SDK.

const { WebSocket } = require('ws');
global.WebSocket = WebSocket;

// ── 2. Load the SDK ────────────────────────────────────────────────────────────

const { ArcSatelliteClient } = require('../arc-satellite-sdk.js');

// ── 3. Create the client ───────────────────────────────────────────────────────

const arc = new ArcSatelliteClient({
  appName:    'My Attraction',
  appVersion: '1.0.0',
  port:       25585,      // default — change if your Satellite uses a different port
  debug:      false,      // set to true to see every raw message in the console
});

// ── 4. Connection events ───────────────────────────────────────────────────────

arc.on('open', () => {
  console.log('[arc] Connected to Satellite at', arc.wsUrl);
  console.log('[arc] Waiting for a player to tap their wristband…\n');
});

arc.on('close', () => {
  console.log('[arc] Disconnected — will reconnect automatically.');
});

arc.on('error', (err) => {
  console.error('[arc] Connection error:', err.message);
});

// ── 5. Session events ──────────────────────────────────────────────────────────

arc.on('session-start', ({ customer }) => {
  const name   = customer?.display_name ?? customer?.first_name ?? 'Player';
  const points = customer?.loyalty?.points_label ?? 'no loyalty data';
  const tier   = customer?.loyalty?.tier_label   ?? '';

  console.log('─────────────────────────────────────');
  console.log(`👋  Welcome, ${name}!`);
  if (tier) console.log(`    Tier     : ${tier}`);
  console.log(`    Points   : ${points}`);
  console.log(`    Session  : ${arc.sessionId}`);
  console.log('─────────────────────────────────────\n');

  // Simulate the game starting — in a real app you'd start your game loop here.
  simulateGame();
});

arc.on('session-end', () => {
  console.log('\n[arc] Session ended — resetting to attract screen.\n');
  console.log('[arc] Waiting for next player…\n');
});

// ── 6. Command event ───────────────────────────────────────────────────────────
//
// The Arc server can push commands to your app at any time.
// Common actions: 'activate', 'pause', 'end-game', 'show-content', etc.

arc.on('command', (msg) => {
  console.log(`[arc] Command received: action="${msg.action}"`, msg.payload ?? '');
});

// ── 7. Connect ─────────────────────────────────────────────────────────────────

arc.connect();

// ── 8. Simulated game flow ─────────────────────────────────────────────────────
//
// In a real attraction this logic lives in your game engine.
// Here we just wait 3 seconds and fire a "game-completed" trigger.

function simulateGame() {
  console.log('[game] Game starting — will fire trigger in 3 s…');

  setTimeout(async () => {
    if (!arc.sessionId) return; // session ended early

    const score = Math.floor(Math.random() * 10000) + 1000;
    console.log(`[game] Game over! Score: ${score}`);

    // sendTrigger attaches the current session_id automatically.
    arc.sendTrigger('game-completed', { score });
    console.log('[arc] Trigger "game-completed" sent with score', score);

    // Optionally use the sendScore shorthand:
    // arc.sendScore(score, { level: 3, time_seconds: 45 });

    // Signal to the Satellite that the player can leave:
    // arc.closeSession();
  }, 3000);
}
