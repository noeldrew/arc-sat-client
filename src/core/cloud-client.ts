import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { SatelliteConfig } from "./config";
import { SatelliteEvents } from "./events";
import { CloudInboundMessage, CloudInboundSchema, CloudOutboundMessage, CloudOutboundSchema } from "./protocol/cloud";

const toWebSocketUrl = (serverUrl: string): string => {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws/satellite`;
  url.search = "";
  url.hash = "";
  return url.toString();
};

export class CloudClient extends EventEmitter {
  private socket?: WebSocket;
  private stopped = true;
  private reconnectAttempt = 0;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(private config: SatelliteConfig, private readonly events: SatelliteEvents) { super(); }

  updateConfig(config: SatelliteConfig): void {
    this.config = config;
    if (!this.stopped) this.reconnect();
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, "client stopped");
    this.socket = undefined;
    this.emit("state", "stopped");
  }

  reconnect(): void {
    this.socket?.close(1000, "configuration changed");
    this.socket = undefined;
    this.reconnectAttempt = 0;
    if (!this.stopped) this.connect();
  }

  isConnected(): boolean { return this.socket?.readyState === WebSocket.OPEN; }

  send(message: CloudOutboundMessage): boolean {
    const validated = CloudOutboundSchema.parse(message);
    if (!this.isConnected()) return false;
    this.socket!.send(JSON.stringify(validated));
    this.events.log("cloud-out", validated as unknown as Record<string, unknown>);
    return true;
  }

  private connect(): void {
    if (this.stopped) return;
    this.emit("state", this.reconnectAttempt ? "reconnecting" : "connecting");
    let socket: WebSocket;
    try { socket = new WebSocket(toWebSocketUrl(this.config.serverUrl), { handshakeTimeout: 10_000 }); }
    catch (error) { this.scheduleReconnect(error); return; }
    this.socket = socket;

    socket.once("open", () => {
      this.emit("state", "registering");
      this.send({
        type: "connect", client_id: this.config.clientId, name: this.config.name,
        version: "0.1.0", triggers: this.config.triggers,
        ...(this.config.apiToken ? { api_token: this.config.apiToken } : {}),
        ...(this.config.installationId ? { installation_id: this.config.installationId } : {}),
        ...(this.config.siteId ? { site_id: this.config.siteId } : {}),
        ...(this.config.description ? { description: this.config.description } : {}),
        ...(this.config.zone ? { zone: this.config.zone } : {}),
        ...(this.config.applicationType ? { application_type: this.config.applicationType } : {}),
      });
    });

    socket.on("message", (data) => this.receive(data.toString()));
    socket.once("error", (error) => this.events.log("error", { source: "cloud", detail: error.message }));
    socket.once("close", (code, reason) => {
      if (this.socket === socket) this.socket = undefined;
      if (code === 4401) {
        this.stopped = true;
        this.emit("state", "auth-failed");
        return;
      }
      if (!this.stopped) this.scheduleReconnect(new Error(`Cloud closed ${code}: ${reason.toString()}`));
    });
  }

  private receive(raw: string): void {
    let decoded: unknown;
    try { decoded = JSON.parse(raw); }
    catch { this.events.log("error", { source: "cloud", detail: "Invalid JSON", raw }); return; }
    const result = CloudInboundSchema.safeParse(decoded);
    if (!result.success) {
      this.events.log("error", { source: "cloud", detail: "Invalid message", issues: result.error.issues });
      return;
    }
    const message = result.data;
    this.events.log("cloud-in", message as unknown as Record<string, unknown>);
    if (message.type === "ping") this.send({ type: "pong", client_id: this.config.clientId });
    if (message.type === "ack" && message.ref === "connect") {
      this.reconnectAttempt = 0;
      this.emit("registered", message);
      this.emit("state", "connected");
    }
    this.emit("message", message satisfies CloudInboundMessage);
  }

  private scheduleReconnect(error: unknown): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(30_000, 2_000 * 1.5 ** this.reconnectAttempt++);
    this.events.log("error", { source: "cloud", detail: error instanceof Error ? error.message : String(error), retryMs: delay });
    this.emit("state", "reconnecting");
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; this.connect(); }, delay);
  }
}

export { toWebSocketUrl };
