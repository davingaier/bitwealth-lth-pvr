// Bybit V5 WebSocket streams with auto-reconnect, heartbeat and resubscribe.
import type { ExchangeCredentials } from "../types.ts";
import { hmacSha256Hex, sleep } from "../util.ts";
import { logger } from "../../log.ts";

const log = logger("bybit.ws");
const PING_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;

type Json = Record<string, unknown>;

interface Options {
  url: string;
  topics: string[];
  onMessage: (msg: Json) => void;
  creds?: ExchangeCredentials; // private stream only
  label: string;
}

/**
 * Minimal resilient Bybit socket. Owns one WebSocket, pings every 20 s, resubscribes on reconnect
 * and authenticates first when credentials are supplied.
 */
export class BybitSocket {
  private ws: WebSocket | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  private backoff = 1000;
  private _connected = false;
  lastMessageAt = 0;

  constructor(private readonly opts: Options) {}

  get connected(): boolean {
    return this._connected;
  }

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.clearPing();
    try {
      this.ws?.close();
    } catch { /* ignore */ }
    this._connected = false;
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;

    ws.onopen = async () => {
      log.info("connected", { label: this.opts.label });
      this.backoff = 1000;
      this._connected = true;
      if (this.opts.creds) await this.authenticate(ws, this.opts.creds);
      this.subscribe(ws);
      this.startPing(ws);
    };

    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      let msg: Json;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      if (msg.op === "pong" || msg.ret_msg === "pong") return;
      if (msg.op === "auth" && msg.success === false) {
        log.error("auth failed", { label: this.opts.label, msg });
        return;
      }
      if (msg.op === "subscribe") {
        if (msg.success === false) log.error("subscribe failed", { label: this.opts.label, msg });
        return;
      }
      this.opts.onMessage(msg);
    };

    ws.onerror = (ev) => {
      log.warn("socket error", { label: this.opts.label, err: (ev as ErrorEvent).message ?? "unknown" });
    };

    ws.onclose = async () => {
      this._connected = false;
      this.clearPing();
      if (this.closed) return;
      log.warn("disconnected; reconnecting", { label: this.opts.label, backoffMs: this.backoff });
      await sleep(this.backoff);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      this.connect();
    };
  }

  private async authenticate(ws: WebSocket, creds: ExchangeCredentials): Promise<void> {
    const expires = Date.now() + 10_000;
    const signature = await hmacSha256Hex(creds.apiSecret, `GET/realtime${expires}`);
    ws.send(JSON.stringify({ op: "auth", args: [creds.apiKey, expires, signature] }));
  }

  private subscribe(ws: WebSocket): void {
    // Bybit caps args per request; chunk to stay well under the limit.
    for (let i = 0; i < this.opts.topics.length; i += 10) {
      ws.send(JSON.stringify({ op: "subscribe", args: this.opts.topics.slice(i, i + 10) }));
    }
  }

  private startPing(ws: WebSocket): void {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: "ping" }));
    }, PING_MS);
  }

  private clearPing(): void {
    if (this.pingTimer !== undefined) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }
}
