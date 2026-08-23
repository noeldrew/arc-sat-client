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

export class ConfigStore {
  constructor(private readonly filePath = path.join(app.getPath("userData"), "config.json")) {}

  async load(): Promise<SatelliteConfig> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8")) as Record<string, unknown>;
      if (typeof raw.apiTokenEncrypted === "string" && safeStorage.isEncryptionAvailable()) {
        raw.apiToken = safeStorage.decryptString(Buffer.from(raw.apiTokenEncrypted, "base64"));
      }
      delete raw.apiTokenEncrypted;
      return SatelliteConfigSchema.parse(raw);
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
