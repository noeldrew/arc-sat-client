import { describe, expect, it } from "vitest";
import { migrateLegacyConfig } from "../src/core/config";

describe("legacy PySide configuration migration", () => {
  it("preserves identity, ports, launcher and monitoring settings", () => {
    const migrated = migrateLegacyConfig({
      client_id: "00000000-0000-4000-8000-000000000001", name: "Legacy", server_url: "https://arc.example",
      local_ws_port: 25585, launcher_type: "file", launcher_path: "Zombears.exe", launcher_on_session: true,
      monitored_processes: ["Zombears.exe"], health_cpu_threshold: 80,
    });
    expect(migrated).toMatchObject({ name: "Legacy", localWsPort: 25585, launcher: { path: "Zombears.exe", onSession: true }, monitoring: { processes: ["Zombears.exe"], cpuThreshold: 80 } });
  });
});
