import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ActivityEntry } from "./events";
import type { SatelliteConfig } from "./config";

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, /token|password|secret/i.test(key) ? "[REDACTED]" : redact(child)]));
  return value;
};

export class Diagnostics {
  constructor(private readonly directory: string) {}
  private get logPath(): string { return path.join(this.directory, "satellite.log"); }

  async append(entry: ActivityEntry): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    try { if ((await stat(this.logPath)).size > 5 * 1024 * 1024) await rename(this.logPath, `${this.logPath}.1`); } catch { /* first log entry */ }
    await appendFile(this.logPath, `${JSON.stringify(redact(entry))}\n`);
  }

  async export(target: string, config: SatelliteConfig, status: unknown, stats: unknown): Promise<void> {
    let log = ""; try { log = await readFile(this.logPath, "utf8"); } catch { /* no log yet */ }
    await writeFile(target, JSON.stringify({ generatedAt: new Date().toISOString(), config: redact(config), status, stats, recentLog: log.split("\n").filter(Boolean).slice(-500).map((line) => JSON.parse(line)) }, null, 2));
  }

  async exportLogs(target: string): Promise<void> {
    const read = async (file: string): Promise<string> => {
      try { return await readFile(file, "utf8"); } catch { return ""; }
    };
    const content = `${await read(`${this.logPath}.1`)}${await read(this.logPath)}`;
    const entries = content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ActivityEntry);
    await writeFile(
      target,
      `${JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2)}\n`,
      { mode: 0o600 },
    );
  }
}
