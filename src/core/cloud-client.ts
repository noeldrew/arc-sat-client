import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { SatelliteConfig } from "./config";
import { SatelliteEvents } from "./events";
import { CloudInboundMessage, CloudInboundSchema, CloudOutboundMessage, CloudOutboundSchema } from "./protocol/cloud";

const DEFAULT_REGISTRATION_TIMEOUT_MS = 10_000;

const describeError = (error: unknown): string => {
  if (error instanceof AggregateError) {
    const details = error.errors.map(describeError).filter(Boolean).join("; ");
    return details || error.message || "Unknown aggregate connection error";
  }
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? ` (${error.code})` : "";
    return `${error.message || error.name}${code}`;
  }
  return String(error);
};

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
  private registrationTimer?: NodeJS.Timeout;

  constructor(
    private config: SatelliteConfig,
    private readonly events: SatelliteEvents,
    private readonly registrationTimeoutMs = DEFAULT_REGISTRATION_TIMEOUT_MS,
  ) { super(); }

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
    this.clearRegistrationTimer();
    this.socket?.close(1000, "client stopped");
    this.socket = undefined;
    this.emit("state", "stopped");
  }

  reconnect(): void {
    this.clearRegistrationTimer();
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
    const endpoint = toWebSocketUrl(this.config.serverUrl);
    this.events.log("system", { type: "cloud-connecting", endpoint, attempt: this.reconnectAttempt + 1 });
    let socket: WebSocket;
    try { socket = new WebSocket(endpoint, { handshakeTimeout: 10_000 }); }
    catch (error) { this.scheduleReconnect(error); return; }
    this.socket = socket;

    socket.once("open", () => {
      this.emit("state", "registering");
      this.events.log("system", { type: "cloud-transport-open", endpoint });
      const sent = this.send({
        type: "connect", client_id: this.config.clientId, name: this.config.name,
        version: "0.1.0", triggers: this.config.triggers,
        ...(this.config.apiToken ? { api_token: this.config.apiToken } : {}),
        ...(this.config.installationId ? { installation_id: this.config.installationId } : {}),
        ...(this.config.siteId ? { site_id: this.config.siteId } : {}),
        ...(this.config.description ? { description: this.config.description } : {}),
        ...(this.config.zone ? { zone: this.config.zone } : {}),
        ...(this.config.applicationType ? { application_type: this.config.applicationType } : {}),
      });
      if (sent) {
        this.clearRegistrationTimer();
        this.registrationTimer = setTimeout(() => {
          if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
          this.events.log("error", {
            source: "cloud",
            detail: "Server registration acknowledgement timed out",
            timeoutMs: this.registrationTimeoutMs,
          });
          socket.terminate();
        }, this.registrationTimeoutMs);
      }
    });

    socket.on("message", (data) => this.receive(data.toString()));
    socket.once("error", (error) => this.events.log("error", { source: "cloud", detail: describeError(error) }));
    socket.once("close", (code, reason) => {
      this.clearRegistrationTimer();
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
      this.clearRegistrationTimer();
      this.reconnectAttempt = 0;
      this.events.log("system", { type: "cloud-registered" });
      this.emit("registered", message);
      this.emit("state", "connected");
    }
    this.emit("message", message satisfies CloudInboundMessage);
  }

  private scheduleReconnect(error: unknown): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(30_000, 2_000 * 1.5 ** this.reconnectAttempt++);
    this.events.log("error", { source: "cloud", detail: describeError(error), retryMs: delay });
    this.emit("state", "reconnecting");
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; this.connect(); }, delay);
  }

  private clearRegistrationTimer(): void {
    if (this.registrationTimer) clearTimeout(this.registrationTimer);
    this.registrationTimer = undefined;
  }
}

export { toWebSocketUrl };
