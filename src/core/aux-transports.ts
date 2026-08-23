import { EventEmitter } from "node:events";
import dgram from "node:dgram";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import { SatelliteEvents } from "./events";

type Handler = (message: unknown, source: "http" | "tcp" | "udp") => Promise<Record<string, unknown> | undefined>;

export interface AuxTransportConfig { httpEnabled: boolean; httpPort: number; tcpEnabled: boolean; tcpPort: number; udpEnabled: boolean; udpPort: number; }

export class AuxTransports extends EventEmitter {
  private httpServer?: http.Server; private tcpServer?: net.Server; private udpSocket?: dgram.Socket;
  constructor(private readonly handler: Handler, private readonly events: SatelliteEvents) { super(); }

  async start(config: AuxTransportConfig): Promise<void> {
    await this.stop();
    const starts: Promise<void>[] = [];
    if (config.httpEnabled) starts.push(this.startHttp(config.httpPort));
    if (config.tcpEnabled) starts.push(this.startTcp(config.tcpPort));
    if (config.udpEnabled) starts.push(this.startUdp(config.udpPort));
    const results = await Promise.allSettled(starts);
    for (const result of results) if (result.status === "rejected") this.events.log("error", { source: "aux-transport", detail: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  }

  async stop(): Promise<void> {
    const closers: Promise<void>[] = [];
    if (this.httpServer) closers.push(new Promise((resolve) => this.httpServer!.close(() => resolve())));
    if (this.tcpServer) closers.push(new Promise((resolve) => this.tcpServer!.close(() => resolve())));
    if (this.udpSocket) closers.push(new Promise((resolve) => this.udpSocket!.close(() => resolve())));
    this.httpServer = undefined; this.tcpServer = undefined; this.udpSocket = undefined;
    await Promise.all(closers);
  }

  private startHttp(port: number): Promise<void> {
    this.httpServer = http.createServer((request, response) => void this.handleHttp(request, response));
    return this.listen(this.httpServer, port, "http");
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Content-Type", "application/json"); response.setHeader("Access-Control-Allow-Origin", "null");
    if (request.method === "GET") { response.end(JSON.stringify({ type: "status", ok: true })); return; }
    if (request.method !== "POST") { response.statusCode = 405; response.end(JSON.stringify({ type: "error", detail: "Use POST with a JSON body" })); return; }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    try { const result = await this.handle(JSON.parse(Buffer.concat(chunks).toString("utf8")), "http"); response.end(JSON.stringify(result ?? { type: "ok" })); }
    catch (error) { response.statusCode = 400; response.end(JSON.stringify({ type: "error", detail: error instanceof Error ? error.message : String(error) })); }
  }

  private startTcp(port: number): Promise<void> {
    this.tcpServer = net.createServer((socket) => {
      socket.setEncoding("utf8"); let buffer = "";
      socket.on("data", (chunk) => { buffer += chunk; let newline: number; while ((newline = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1); if (line) void this.handleLine(line, socket); } });
    });
    return this.listen(this.tcpServer, port, "tcp");
  }

  private async handleLine(line: string, socket: net.Socket): Promise<void> {
    try { const result = await this.handle(JSON.parse(line), "tcp"); if (result) socket.write(`${JSON.stringify(result)}\n`); }
    catch { socket.write(`${JSON.stringify({ type: "error", detail: "Invalid JSON line" })}\n`); }
  }

  private startUdp(port: number): Promise<void> {
    const socket = dgram.createSocket("udp4"); this.udpSocket = socket;
    socket.on("message", (data, remote) => void (async () => { try { const message = JSON.parse(data.toString("utf8")) as Record<string, unknown>; const result = await this.handle(message, "udp"); if (result && (message.reply === true || message.type === "hello" || message.type === "close-session")) socket.send(JSON.stringify(result), remote.port, remote.address); } catch { /* Datagram messages are intentionally fire-and-forget. */ } })());
    return new Promise((resolve, reject) => { socket.once("error", reject); socket.bind(port, "127.0.0.1", () => { this.emit("listening", { type: "udp", port }); resolve(); }); });
  }

  private listen(server: http.Server | net.Server, port: number, type: string): Promise<void> {
    return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "localhost", () => { this.emit("listening", { type, port }); resolve(); }); });
  }

  private async handle(message: unknown, source: "http" | "tcp" | "udp"): Promise<Record<string, unknown> | undefined> {
    this.events.log("local-in", { ...(message as Record<string, unknown>), transport: source });
    const result = await this.handler(message, source);
    if (result) this.events.log("local-out", { ...result, transport: source });
    return result;
  }
}
