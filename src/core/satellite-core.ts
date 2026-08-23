import { randomUUID } from "node:crypto";
import type { SatelliteConfig } from "./config";
import { CloudClient } from "./cloud-client";
import { SatelliteEvents, SatelliteStatus } from "./events";
import { LocalWebSocketTransport } from "./local-websocket";
import type { CloudInboundMessage } from "./protocol/cloud";
import type { TriggerDefinition } from "./protocol/common";
import type { LocalInboundMessage } from "./protocol/local";

export interface SatelliteCoreOptions {
  config: SatelliteConfig;
  saveConfig: (config: SatelliteConfig) => Promise<void>;
}

export class SatelliteCore {
  readonly events = new SatelliteEvents();
  readonly cloud: CloudClient;
  readonly local: LocalWebSocketTransport;
  private config: SatelliteConfig;
  private cloudSessionId?: string;
  private customer?: Record<string, unknown>;
  private status: SatelliteStatus = { cloud: "stopped", localTransport: "stopped", localAppConnected: false };

  constructor(private readonly options: SatelliteCoreOptions) {
    this.config = options.config;
    this.cloud = new CloudClient(this.config, this.events);
    this.local = new LocalWebSocketTransport(this.events);
    this.wire();
  }

  async start(): Promise<void> {
    await this.local.start(this.config.localWsPort);
    this.cloud.start();
  }

  async stop(): Promise<void> {
    this.cloud.stop();
    await this.local.stop();
  }

  getStatus(): SatelliteStatus { return { ...this.status }; }
  getConfig(): SatelliteConfig { return structuredClone(this.config); }

  async updateConfig(config: SatelliteConfig): Promise<void> {
    const oldPort = this.config.localWsPort;
    this.config = config;
    await this.options.saveConfig(config);
    this.cloud.updateConfig(config);
    if (oldPort !== config.localWsPort) await this.local.start(config.localWsPort);
  }

  private wire(): void {
    this.cloud.on("state", (cloud) => this.updateStatus({ cloud }));
    this.cloud.on("registered", (ack: { api_token?: string; canonical_client_id?: string }) => {
      let changed = false;
      if (ack.api_token) { this.config.apiToken = ack.api_token; changed = true; }
      if (ack.canonical_client_id) { this.config.clientId = ack.canonical_client_id; changed = true; }
      if (changed) void this.options.saveConfig(this.config);
    });
    this.cloud.on("message", (message: CloudInboundMessage) => this.handleCloud(message));
    this.local.on("state", (localTransport) => this.updateStatus({ localTransport }));
    this.local.on("transport-error", (transportError) => this.updateStatus({ transportError }));
    this.local.on("app-state", (localAppConnected) => this.updateStatus({ localAppConnected }));
    this.local.on("hello", (message: Extract<LocalInboundMessage, { type: "hello" }>, localSessionId: string) => {
      this.mergeTriggers(message.triggers ?? []);
      this.updateStatus({ localSessionId });
      this.local.send({ type: "ack", status: "ok", session_id: this.cloudSessionId });
      if (this.cloudSessionId) this.sendSessionStart("resume");
    });
    this.local.on("message", (message: LocalInboundMessage) => this.handleLocal(message));
    this.local.on("app-disconnected", () => {
      if (this.cloudSessionId) this.sendSessionEnded(this.cloudSessionId);
      this.clearSession();
      this.updateStatus({ localSessionId: undefined });
    });
  }

  private handleCloud(message: CloudInboundMessage): void {
    if (message.type === "session_start") {
      this.cloudSessionId = message.session_id;
      this.customer = message.customer as Record<string, unknown> | undefined;
      this.updateStatus({ cloudSessionId: this.cloudSessionId });
      this.local.send({ ...message, type: "session-start" });
      return;
    }
    if (message.type !== "command") return;
    if (message.action === "get-triggers") {
      this.cloud.send({ type: "triggers-report", client_id: this.config.clientId, triggers: this.config.triggers });
      return;
    }
    if (message.action === "get-snapshot") {
      this.events.emit("snapshot-requested");
      return;
    }
    if (message.action === "session_end") {
      this.local.send({ type: "session-end", session_id: message.session_id ?? this.cloudSessionId });
      this.clearSession();
      return;
    }
    const sessionId = message.session_id ?? (message.payload?.session_id as string | undefined);
    const customer = message.customer as Record<string, unknown> | undefined;
    if (sessionId) {
      this.cloudSessionId = sessionId;
      this.customer = customer;
      this.updateStatus({ cloudSessionId: sessionId });
      this.local.send({ ...message, type: "session-start", session_id: sessionId });
    } else {
      this.local.send(message);
    }
  }

  private handleLocal(message: LocalInboundMessage): void {
    if (message.type === "register-triggers") { this.mergeTriggers(message.triggers); return; }
    if (message.type === "trigger") {
      const payload = { ...(message.payload ?? {}) } as Record<string, unknown>;
      const customerId = this.customer?.id;
      if (customerId && !payload.customer_id) payload.customer_id = customerId;
      this.cloud.send({
        type: "trigger", client_id: this.config.clientId, trigger_id: message.trigger_id,
        session_id: message.session_id ?? this.cloudSessionId ?? this.local.getLocalSessionId(), payload,
      });
      return;
    }
    if (message.type === "session-started" && this.cloudSessionId) {
      this.cloud.send({
        type: "session-started", client_id: this.config.clientId,
        session_id: this.cloudSessionId,
        ...(typeof this.customer?.id === "string" ? { customer_id: this.customer.id } : {}),
      });
      this.local.send({ type: "ack", ref: "session-started", ok: true });
      return;
    }
    if (message.type === "session-ended" || message.type === "close-session") {
      if (this.cloudSessionId) this.sendSessionEnded(this.cloudSessionId);
      this.clearSession();
    }
  }

  private mergeTriggers(incoming: TriggerDefinition[]): void {
    if (!incoming.length) return;
    const incomingIds = new Set(incoming.map((trigger) => trigger.id));
    this.config.triggers = [...incoming, ...this.config.triggers.filter((trigger) => !incomingIds.has(trigger.id))];
    void this.options.saveConfig(this.config);
    this.cloud.send({ type: "triggers-update", client_id: this.config.clientId, triggers: this.config.triggers });
    this.events.emit("config", this.getConfig());
  }

  private sendSessionStart(action: string): void {
    if (!this.cloudSessionId) return;
    this.local.send({ type: "session-start", session_id: this.cloudSessionId, action, ...(this.customer ? { customer: this.customer as { id: string } } : {}) });
  }

  private sendSessionEnded(sessionId: string): void {
    this.cloud.send({
      type: "session-ended", client_id: this.config.clientId, session_id: sessionId,
      ...(typeof this.customer?.id === "string" ? { customer_id: this.customer.id } : {}),
    });
  }

  private clearSession(): void {
    this.cloudSessionId = undefined;
    this.customer = undefined;
    this.updateStatus({ cloudSessionId: undefined });
  }

  private updateStatus(patch: Partial<SatelliteStatus>): void {
    this.status = { ...this.status, ...patch };
    this.events.emit("status", this.getStatus());
  }
}

export const createTestConfig = (patch: Partial<SatelliteConfig> = {}): SatelliteConfig => ({
  schemaVersion: 1, clientId: randomUUID(), name: "ARC Satellite", description: "", zone: "", applicationType: "",
  serverUrl: "http://localhost:8080", localWsPort: 25585, localHttpEnabled: true, localHttpPort: 25586,
  localTcpEnabled: true, localTcpPort: 25587, localUdpEnabled: true, localUdpPort: 25588, triggers: [],
  launcher: { type: "none", path: "", script: "", onConnect: false, onSession: false, delaySeconds: 5, queueSession: true, autoRelaunch: false, relaunchCooldownSeconds: 60 },
  monitoring: { processes: [], cpuThreshold: 85, ramThreshold: 90, diskThreshold: 90, intervalSeconds: 15 },
  ...patch,
});
