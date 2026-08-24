import { describe, expect, it } from "vitest";
import { SatelliteCore, createTestConfig } from "../src/core/satellite-core";

describe("end-to-end readiness state", () => {
  it("distinguishes a raw app socket, SDK registration and trigger registration", () => {
    const core = new SatelliteCore({
      config: createTestConfig(),
      saveConfig: async () => undefined,
    });

    core.cloud.emit("state", "connected");
    core.local.emit("app-state", true);
    expect(core.getStatus()).toMatchObject({
      cloud: "connected",
      localAppConnected: true,
      localAppRegistered: false,
      triggersRegistered: false,
    });

    core.local.emit("hello", { type: "hello", triggers: [] }, "local-session");
    expect(core.getStatus()).toMatchObject({
      localAppConnected: true,
      localAppRegistered: true,
      triggersRegistered: false,
    });

    core.cloud.emit("message", { type: "ack", ref: "triggers-update" });
    expect(core.getStatus().triggersRegistered).toBe(true);

    core.cloud.emit("state", "reconnecting");
    expect(core.getStatus().triggersRegistered).toBe(false);
  });
});
