import { execFile } from "node:child_process";
import dgram from "node:dgram";
import { promisify } from "node:util";

export type HostPowerAction = "restart" | "sleep" | "shutdown" | "wake-on-lan";
export type PowerPayload = { mac_address?: string; broadcast_address?: string; port?: number };

const execFileAsync = promisify(execFile);

export const normalisePowerAction = (action: string): HostPowerAction | undefined => ({
  "host.restart": "restart",
  "host.sleep": "sleep",
  "host.shutdown": "shutdown",
  "host.wake": "wake-on-lan",
  "host.wake-on-lan": "wake-on-lan",
}[action] as HostPowerAction | undefined);

export const powerCommandForPlatform = (action: Exclude<HostPowerAction, "wake-on-lan">, platform = process.platform): { command: string; args: string[] } => {
  if (platform === "darwin") {
    const verb = action === "restart" ? "restart" : action === "shutdown" ? "shut down" : "sleep";
    return { command: "osascript", args: ["-e", `tell application \"System Events\" to ${verb}`] };
  }
  if (platform === "win32") {
    if (action === "restart") return { command: "shutdown.exe", args: ["/r", "/t", "0", "/f"] };
    if (action === "shutdown") return { command: "shutdown.exe", args: ["/s", "/t", "0", "/f"] };
    return { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"] };
  }
  return { command: "systemctl", args: [action === "restart" ? "reboot" : action === "shutdown" ? "poweroff" : "suspend"] };
};

export const wakePacket = (macAddress: string): Buffer => {
  const compact = macAddress.replace(/[:-]/g, "").toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(compact) || compact === "000000000000") throw new Error("A valid non-zero MAC address is required for Wake-on-LAN.");
  const mac = Buffer.from(compact, "hex");
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => mac)]);
};

const sendWakePacket = async (payload: PowerPayload): Promise<void> => {
  const packet = wakePacket(payload.mac_address ?? "");
  const host = payload.broadcast_address?.trim() || "255.255.255.255";
  const port = payload.port ?? 9;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Wake-on-LAN port must be between 1 and 65535.");
  await new Promise<void>((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", (error) => { socket.close(); reject(error); });
    socket.bind(0, () => {
      socket.setBroadcast(true);
      socket.send(packet, port, host, (error) => { socket.close(); error ? reject(error) : resolve(); });
    });
  });
};

export const executeHostPowerAction = async (action: HostPowerAction, payload: PowerPayload = {}): Promise<void> => {
  if (action === "wake-on-lan") return sendWakePacket(payload);
  const command = powerCommandForPlatform(action);
  await execFileAsync(command.command, command.args, { timeout: 10_000 });
};
