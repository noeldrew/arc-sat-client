import { describe, expect, it } from "vitest";
import { CloudInboundSchema, CloudOutboundSchema } from "../src/core/protocol/cloud";
import { LocalInboundSchema, LocalOutboundSchema } from "../src/core/protocol/local";

describe("ARC cloud protocol", () => {
  it("accepts the registration frame expected by the Python server", () => {
    expect(CloudOutboundSchema.parse({
      type: "connect",
      client_id: "satellite-id",
      name: "Zombears Satellite",
      version: "0.1.0",
      triggers: [{ id: "game-started", name: "Game Started" }],
    }).type).toBe("connect");
  });

  it("accepts an RFID command with session context", () => {
    const message = CloudInboundSchema.parse({
      type: "command",
      action: "activate",
      session_id: "session-1",
      customer: { id: "customer-1", display_name: "Player" },
    });
    expect(message.type).toBe("command");
  });
});

describe("local C# SDK protocol", () => {
  it("accepts the C# SDK hello and trigger list", () => {
    expect(LocalInboundSchema.parse({
      type: "hello",
      app: "Zombears",
      version: "1.0.0",
      triggers: [{ id: "game-completed", name: "Game Completed" }],
    }).type).toBe("hello");
  });

  it("accepts the session-start shape consumed by the C# SDK", () => {
    expect(LocalOutboundSchema.parse({
      type: "session-start",
      session_id: "session-1",
      action: "activate",
      customer: { id: "customer-1" },
    }).type).toBe("session-start");
  });
});
