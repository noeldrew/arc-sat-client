import { describe, expect, it } from "vitest";
import { createTestConfig } from "../src/core/satellite-core";
import { healthReasons, type SystemSnapshot } from "../src/core/system-monitor";

const snapshot: SystemSnapshot = {
  cpu_percent: 91, cpu_per_core: [91], ram_percent: 42, ram_used_mb: 10, ram_total_mb: 20,
  swap_percent: 0, disk_percent: 95, uptime_seconds: 100, processes: {}, os: "test",
  os_version: "1", hostname: "host", sampled_at: new Date(0).toISOString(),
};

describe("system health thresholds", () => {
  it("reports only crossed thresholds", () => {
    expect(healthReasons(snapshot, createTestConfig())).toEqual(["CPU 91.0%", "Disk 95.0%"]);
  });
});
