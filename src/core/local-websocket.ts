import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";
import { SatelliteEvents } from "./events";
import { LocalInboundMessage, LocalInboundSchema, LocalOutboundMessage, LocalOutboundSchema } from "./protocol/local";

export class LocalWebSocketTransport extends EventEmitter {
  private server?: WebSocketServer;
  private appSocket?: WebSocket;
  private localSessionId?: string;

  constructor(private readonly events: SatelliteEvents) { super(); }

  async start(port: number): Promise<void> {
    await this.stop();
    this.emit("state", "starting");
    const server = new WebSocketServer({ host: "localhost", port });
    this.server = server;
    server.on("connection", (socket) => this.accept(socket));
    server.on("error", (error) => {
      this.events.log("error", { source: "local-websocket", port, detail: error.message });
      this.emit("transport-error", error.message);
      this.emit("state", "error");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    this.emit("listening", { host: "localhost", port });
    this.emit("state", "connected");
  }

  async stop(): Promise<void> {
    this.appSocket?.close(1001, "transport restarting");
    this.appSocket = undefined;
    this.localSessionId = undefined;
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.emit("state", "stopped");
  }

  isAppConnected(): boolean { return this.appSocket?.readyState === WebSocket.OPEN; }
  getLocalSessionId(): string | undefined { return this.localSessionId; }

  send(message: LocalOutboundMessage): boolean {
    const validated = LocalOutboundSchema.parse(message);
    if (!this.isAppConnected()) return false;
    try {
      this.appSocket!.send(JSON.stringify(validated));
      this.events.log("local-out", validated as unknown as Record<string, unknown>);
      return true;
    } catch (error) {
      this.events.log("error", { source: "local-websocket", detail: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  private accept(socket: WebSocket): void {
    if (this.appSocket && this.appSocket !== socket) this.appSocket.close(4000, "superseded by a newer app connection");
    this.appSocket = socket;
    this.emit("app-state", true);
    socket.on("message", (data) => this.receive(socket, data.toString()));
    socket.once("close", () => {
      if (this.appSocket === socket) {
        this.appSocket = undefined;
        this.localSessionId = undefined;
        this.emit("app-state", false);
        this.emit("app-disconnected");
      }
    });
  }

  private receive(socket: WebSocket, raw: string): void {
    let decoded: unknown;
    try { decoded = JSON.parse(raw); }
    catch { this.reply(socket, { type: "error", detail: "Invalid JSON" }); return; }
    const result = LocalInboundSchema.safeParse(decoded);
    if (!result.success) {
      this.reply(socket, { type: "error", detail: "Invalid local message" });
      this.events.log("error", { source: "local-websocket", issues: result.error.issues });
      return;
    }
    const message = result.data;
    this.events.log("local-in", message as unknown as Record<string, unknown>);
    if (message.type === "hello") {
      this.localSessionId = randomUUID();
      this.emit("hello", message, this.localSessionId);
    } else if (message.type === "ping") {
      this.reply(socket, { type: "pong" });
    }
    this.emit("message", message satisfies LocalInboundMessage);
  }

  private reply(socket: WebSocket, message: LocalOutboundMessage): void {
    const validated = LocalOutboundSchema.parse(message);
    socket.send(JSON.stringify(validated));
    this.events.log("local-out", validated as unknown as Record<string, unknown>);
  }
}
