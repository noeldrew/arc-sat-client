import { describe, expect, it } from "vitest";
import { AppLauncher } from "../src/core/app-launcher";
import { SatelliteEvents, type ActivityEntry } from "../src/core/events";
import { createTestConfig } from "../src/core/satellite-core";

describe("AppLauncher", () => {
  it("does not auto-launch when the application is already running", () => {
    const events = new SatelliteEvents();
    const activity: ActivityEntry[] = [];
    events.on("activity", (entry) => activity.push(entry));
    const config = createTestConfig({
      launcher: {
        type: "file", path: "/Applications/Zombears.app", script: "", onConnect: true,
        onClientStart: false, clientStartDelaySeconds: 5, onSession: false, delaySeconds: 5,
        queueSession: true, autoRelaunch: false, relaunchCooldownSeconds: 60,
      },
    });
    const launcher = new AppLauncher(() => config, events, () => true);

    expect(launcher.launch("cloud-connect")).toBe(false);
    expect(activity[0]?.message).toMatchObject({ type: "app-launch-skipped", reason: "cloud-connect" });
  });
});
