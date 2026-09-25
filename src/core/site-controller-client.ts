import WebSocket from "ws";
import type { SatelliteConfig } from "./config";
import { executeHostPowerAction } from "./system-power";

export interface ControllerEmergency { eventId: string; severity: "information" | "warning" | "critical"; title: string; message: string; instruction?: string; expiresAt: string; cleared?: boolean }

export class SiteControllerClient {
  private socket?: WebSocket; private reconnect?: NodeJS.Timeout; private stopped = true;
  constructor(private readonly config: () => SatelliteConfig, private readonly emergency: (message: ControllerEmergency) => void, private readonly activity: (message: Record<string, unknown>) => void) {}
  start(): void { this.stopped = false; this.connect(); }
  restart(): void { this.stop(); this.start(); }
  stop(): void { this.stopped = true; if (this.reconnect) clearTimeout(this.reconnect); this.socket?.close(); this.socket = undefined; }
  private connect(): void {
    const config = this.config(); const target = config.siteController;
    if (this.stopped || !target.enabled) return;
    this.socket = new WebSocket(target.url, target.token ? { headers: { Authorization: `Bearer ${target.token}` } } : undefined);
    this.socket.on("open", () => { this.activity({ type: "site-controller-connected", url: target.url }); this.send({ type: "register", client_id: config.clientId, name: config.name, site_id: config.siteId, zone: config.zone, version: "1.6.9", capabilities: ["restart", "sleep", "shutdown"] }); });
    this.socket.on("message", data => { const message = JSON.parse(data.toString()) as Record<string, unknown>; this.activity({ type: "site-controller-message", ...message }); void this.handle(message); });
    this.socket.on("close", () => { if (!this.stopped) this.reconnect = setTimeout(() => this.connect(), 5000); });
    this.socket.on("error", () => undefined);
  }
  private async handle(message: Record<string, unknown>): Promise<void> {
    if (message.type === "power.command" && ["restart", "sleep", "shutdown"].includes(String(message.action))) {
      this.activity({ type: "power-command-received", action: message.action, request_id: message.request_id });
      try { await executeHostPowerAction(message.action as "restart"|"sleep"|"shutdown", message); this.send({ type: "power.ack", request_id: message.request_id, status: "completed" }); }
      catch (error) { this.send({ type: "power.ack", request_id: message.request_id, status: "failed", detail: error instanceof Error ? error.message : String(error) }); }
    } else if (message.type === "emergency") { this.activity({ type: "emergency-received", event_id: message.eventId, severity: message.severity }); this.emergency(message as unknown as ControllerEmergency); }
    else if (message.type === "emergency.clear") { this.activity({ type: "emergency-cleared", event_id: message.event_id }); this.emergency({ eventId: String(message.event_id), severity: "information", title: "", message: "", expiresAt: new Date().toISOString(), cleared: true }); }
  }
  private send(value: unknown): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value)); }
}
