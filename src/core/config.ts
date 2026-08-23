import { app, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { TriggerDefinitionSchema } from "./protocol/common";

export const SatelliteConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  clientId: z.string().uuid().default(() => randomUUID()),
  name: z.string().min(1).default("ARC Satellite"),
  description: z.string().default(""),
  installationId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
  zone: z.string().default(""),
  applicationType: z.string().default(""),
  serverUrl: z.string().default("http://localhost:8080"),
  apiToken: z.string().optional(),
  localWsPort: z.number().int().min(1024).max(65535).default(25585),
  localHttpEnabled: z.boolean().default(true),
  localHttpPort: z.number().int().min(1024).max(65535).default(25586),
  localTcpEnabled: z.boolean().default(true),
  localTcpPort: z.number().int().min(1024).max(65535).default(25587),
  localUdpEnabled: z.boolean().default(true),
  localUdpPort: z.number().int().min(1024).max(65535).default(25588),
  triggers: z.array(TriggerDefinitionSchema).default([]),
  launcher: z.object({
    type: z.enum(["none", "file", "script"]).default("none"),
    path: z.string().default(""),
    script: z.string().default(""),
    onConnect: z.boolean().default(false),
    onSession: z.boolean().default(false),
    delaySeconds: z.number().int().min(0).max(300).default(5),
    queueSession: z.boolean().default(true),
    autoRelaunch: z.boolean().default(false),
    relaunchCooldownSeconds: z.number().int().min(1).max(86400).default(60),
  }).default({}),
  monitoring: z.object({
    processes: z.array(z.string()).default([]),
    cpuThreshold: z.number().min(0).max(100).default(85),
    ramThreshold: z.number().min(0).max(100).default(90),
    diskThreshold: z.number().min(0).max(100).default(90),
    intervalSeconds: z.number().int().min(3).max(300).default(15),
  }).default({}),
}).strict();

export type SatelliteConfig = z.infer<typeof SatelliteConfigSchema>;

export const migrateLegacyConfig = (raw: Record<string, unknown>): SatelliteConfig => {
  if (raw.schemaVersion === 1) return SatelliteConfigSchema.parse(raw);
  const launcher = {
    type: raw.launcher_type ?? "none", path: raw.launcher_path ?? "", script: raw.launcher_script ?? "",
    onConnect: raw.launcher_on_connect ?? false, onSession: raw.launcher_on_session ?? false,
    delaySeconds: raw.launcher_delay ?? 5, queueSession: raw.launcher_queue_session ?? true,
    autoRelaunch: raw.launcher_auto_relaunch ?? false, relaunchCooldownSeconds: raw.launcher_relaunch_cooldown ?? 60,
  };
  const monitoring = {
    processes: raw.monitored_processes ?? [], cpuThreshold: raw.health_cpu_threshold ?? 85,
    ramThreshold: raw.health_ram_threshold ?? 90, diskThreshold: raw.health_disk_threshold ?? 90, intervalSeconds: 15,
  };
  return SatelliteConfigSchema.parse({
    schemaVersion: 1, clientId: raw.client_id, name: raw.name, description: raw.description,
    installationId: raw.installation_id || undefined, siteId: raw.site_id || undefined, zone: raw.zone,
    applicationType: raw.application_type, serverUrl: raw.server_url, apiToken: raw.api_token || undefined,
    localWsPort: raw.local_ws_port, localHttpEnabled: raw.local_http_enabled, localHttpPort: raw.local_http_port,
    localTcpEnabled: raw.local_tcp_enabled, localTcpPort: raw.local_tcp_port, localUdpEnabled: raw.local_udp_enabled,
    localUdpPort: raw.local_udp_port, triggers: raw.triggers, launcher, monitoring,
  });
};

export class ConfigStore {
  constructor(private readonly filePath = path.join(app.getPath("userData"), "config.json")) {}

  async load(): Promise<SatelliteConfig> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8")) as Record<string, unknown>;
      if (typeof raw.apiTokenEncrypted === "string" && safeStorage.isEncryptionAvailable()) {
        raw.apiToken = safeStorage.decryptString(Buffer.from(raw.apiTokenEncrypted, "base64"));
      }
      delete raw.apiTokenEncrypted;
      return migrateLegacyConfig(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Config load failed", error);
      return SatelliteConfigSchema.parse({});
    }
  }

  async save(config: SatelliteConfig): Promise<void> {
    const parsed = SatelliteConfigSchema.parse(config);
    const persisted: Record<string, unknown> = { ...parsed };
    if (parsed.apiToken && safeStorage.isEncryptionAvailable()) {
      persisted.apiTokenEncrypted = safeStorage.encryptString(parsed.apiToken).toString("base64");
      delete persisted.apiToken;
    }
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(persisted, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}
