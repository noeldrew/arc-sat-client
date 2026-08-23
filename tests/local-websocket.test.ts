import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { SatelliteEvents } from "../src/core/events";
import { LocalWebSocketTransport } from "../src/core/local-websocket";

const transports: LocalWebSocketTransport[] = [];
afterEach(async () => Promise.all(transports.splice(0).map((transport) => transport.stop())));

describe("LocalWebSocketTransport", () => {
  it("accepts the C# SDK hello and exposes trigger definitions", async () => {
    const transport = new LocalWebSocketTransport(new SatelliteEvents());
    transports.push(transport);
    await transport.start(25995);
    const hello = new Promise<{ app: string; triggers?: unknown[] }>((resolve) => transport.once("hello", resolve));
    const app = new WebSocket("ws://localhost:25995");
    await new Promise<void>((resolve) => app.once("open", resolve));
    app.send(JSON.stringify({ type: "hello", app: "Zombears", version: "1.0.0", triggers: [{ id: "score", name: "Score" }] }));
    await expect(hello).resolves.toMatchObject({ app: "Zombears", triggers: [{ id: "score" }] });
    app.close();
  });

  it("rejects a second app connection deterministically", async () => {
    const transport = new LocalWebSocketTransport(new SatelliteEvents());
    transports.push(transport);
    await transport.start(25996);
    const first = new WebSocket("ws://localhost:25996");
    await new Promise<void>((resolve) => first.once("open", resolve));
    const firstClosed = new Promise<number>((resolve) => first.once("close", resolve));
    const second = new WebSocket("ws://localhost:25996");
    await new Promise<void>((resolve) => second.once("open", resolve));
    await expect(firstClosed).resolves.toBe(4000);
    second.close();
  });
});
