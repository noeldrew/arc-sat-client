import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { CloudClient, toWebSocketUrl } from "../src/core/cloud-client";
import { SatelliteEvents } from "../src/core/events";
import { createTestConfig } from "../src/core/satellite-core";

const servers: WebSocketServer[] = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))));

describe("CloudClient", () => {
  it("constructs the server WebSocket endpoint without discarding a base path", () => {
    expect(toWebSocketUrl("https://arc.example/base/")).toBe("wss://arc.example/base/ws/satellite");
  });

  it("registers, handles connect ack and answers server ping", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("Expected TCP address");
    const received: Record<string, unknown>[] = [];
    server.on("connection", (socket) => socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      received.push(message);
      if (message.type === "connect") {
        socket.send(JSON.stringify({ type: "ack", ref: "connect" }));
        socket.send(JSON.stringify({ type: "ping" }));
      }
    }));
    const client = new CloudClient(createTestConfig({ serverUrl: `http://127.0.0.1:${address.port}` }), new SatelliteEvents());
    client.start();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out")), 2_000);
      const poll = setInterval(() => {
        if (received.some((message) => message.type === "pong")) {
          clearInterval(poll); clearTimeout(timeout); resolve();
        }
      }, 10);
    });
    expect(received.map((message) => message.type)).toEqual(["connect", "pong"]);
    client.stop();
  });
});
