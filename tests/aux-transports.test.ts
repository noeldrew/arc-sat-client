import { afterEach, describe, expect, it } from "vitest";
import { AuxTransports } from "../src/core/aux-transports";
import { SatelliteEvents } from "../src/core/events";

const active: AuxTransports[] = [];
afterEach(async () => Promise.all(active.splice(0).map((item) => item.stop())));

describe("alternative localhost transports", () => {
  it("accepts HTTP JSON messages", async () => {
    const transports = new AuxTransports(async (message) => ({ type: "ack", ref: (message as { type: string }).type }), new SatelliteEvents()); active.push(transports);
    await transports.start({ httpEnabled: true, httpPort: 25991, tcpEnabled: false, tcpPort: 25992, udpEnabled: false, udpPort: 25993 });
    const response = await fetch("http://localhost:25991", { method: "POST", body: JSON.stringify({ type: "ping" }) });
    await expect(response.json()).resolves.toEqual({ type: "ack", ref: "ping" });
  });
});
