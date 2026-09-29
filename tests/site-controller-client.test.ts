import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { SiteControllerClient } from "../src/core/site-controller-client";
import { createTestConfig } from "../src/core/satellite-core";

const servers: WebSocketServer[] = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))));

describe("SiteControllerClient", () => {
  it("does not let a replaced socket start a second reconnect loop", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("Expected TCP address");

    let registrations = 0;
    const states: string[] = [];
    server.on("connection", (socket) => socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.type === "register") {
        registrations += 1;
        socket.send(JSON.stringify({ type: "registered", controller: "ARC SITE" }));
      }
    }));

    const endpoint = `ws://127.0.0.1:${address.port}`;
    const config = createTestConfig({ siteController: { enabled: true, url: endpoint, endpoints: [endpoint] } });
    const client = new SiteControllerClient(() => config, () => undefined, () => undefined, (state) => states.push(state));
    client.start();
    await waitFor(() => registrations === 1);
    await waitFor(() => states.at(-1) === "connected");
    client.restart();
    await waitFor(() => registrations === 2);

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(registrations).toBe(2);
    expect(states.at(-1)).toBe("connected");
    client.stop();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
