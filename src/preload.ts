import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("arcSatellite", {
  platform: process.platform,
  version: process.versions.electron,
});
