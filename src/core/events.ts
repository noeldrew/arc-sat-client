import { EventEmitter } from "node:events";

export type ConnectionState = "stopped" | "starting" | "connecting" | "registering" | "connected" | "reconnecting" | "auth-failed" | "error";
export type LogDirection = "cloud-in" | "cloud-out" | "local-in" | "local-out" | "system" | "error";

export interface ActivityEntry {
  at: string;
  direction: LogDirection;
  message: Record<string, unknown>;
}

export interface SatelliteStatus {
  cloud: ConnectionState;
  localTransport: ConnectionState;
  localAppConnected: boolean;
  localAppRegistered: boolean;
  triggersRegistered: boolean;
  cloudSessionId?: string;
  localSessionId?: string;
  transportError?: string;
}

export class SatelliteEvents extends EventEmitter {
  log(direction: LogDirection, message: Record<string, unknown>): void {
    this.emit("activity", { at: new Date().toISOString(), direction, message } satisfies ActivityEntry);
  }
}
