import https from "node:https";
import zlib from "node:zlib";
import { logger } from "../util/log.js";

const log = logger("sse");

export interface SseMessage {
  /** SSE `id:` field, if present. For TxLINE scores this is `timestamp:index`. */
  id: string | null;
  /** SSE `event:` field; defaults to "message". Heartbeats use "heartbeat". */
  event: string;
  /** SSE `data:` payload (multi-line joined by \n), verbatim. */
  data: string;
}

export interface SseOptions {
  url: string;
  headers: Record<string, string>;
  onMessage: (msg: SseMessage) => void;
  onOpen?: (status: number) => void;
  onError?: (err: Error) => void;
  /** Resume cursor: sent as `Last-Event-ID` on (re)connect. */
  lastEventId?: string | null;
  /** Request gzip and gunzip the stream (README §7.3: 70–80% smaller). */
  gzip?: boolean;
  /** Reconnect backoff bounds (ms). */
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * Resilient SSE client tuned for the TxLINE scores/odds streams:
 *  - optional gzip (Accept-Encoding + streaming gunzip)
 *  - auto-reconnect with exponential backoff + jitter
 *  - `Last-Event-ID` resume so no frames are lost across drops
 *
 * Frames are delivered verbatim; the recorder is responsible for persistence.
 */
export class SseClient {
  private readonly opts: Required<Omit<SseOptions, "onOpen" | "onError" | "lastEventId">> &
    Pick<SseOptions, "onOpen" | "onError">;
  private lastEventId: string | null;
  private stopped = true;
  private req: import("node:http").ClientRequest | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  /**
   * Monotonically increasing connection generation. Terminal events from an
   * older request are ignored once a reconnect has been scheduled.
   */
  private generation = 0;
  private backoff: number;

  constructor(options: SseOptions) {
    this.opts = {
      gzip: true,
      minBackoffMs: 1000,
      maxBackoffMs: 30_000,
      ...options,
    };
    this.lastEventId = options.lastEventId ?? null;
    this.backoff = this.opts.minBackoffMs;
  }

  get cursor(): string | null {
    return this.lastEventId;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.req?.destroy();
    this.req = null;
  }

  private scheduleReconnect(reason: string, generation: number): void {
    // A failed stream can emit several terminal events (for example `error`,
    // `aborted`, then `end`). Only the first one may schedule the next request.
    if (this.stopped || generation !== this.generation || this.reconnectTimer) return;
    const jitter = Math.floor(this.backoff * 0.2 * Math.random());
    const delay = Math.min(this.backoff, this.opts.maxBackoffMs) + jitter;
    log.warn(`reconnect in ${delay}ms (${reason})`);

    // Invalidate every callback belonging to this request immediately, and
    // close it before another connection is allowed to start.
    const req = this.req;
    this.req = null;
    const reconnectGeneration = ++this.generation;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped || reconnectGeneration !== this.generation) return;
      this.backoff = Math.min(this.backoff * 2, this.opts.maxBackoffMs);
      this.connect();
    }, delay);
    req?.destroy();
  }

  private connect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const generation = ++this.generation;
    const url = new URL(this.opts.url);
    const headers: Record<string, string> = {
      ...this.opts.headers,
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    };
    if (this.opts.gzip) headers["Accept-Encoding"] = "gzip";
    if (this.lastEventId) headers["Last-Event-ID"] = this.lastEventId;

    const req = https.request(
      {
        method: "GET",
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers,
      },
      (res) => {
        if (this.stopped || generation !== this.generation) {
          res.destroy();
          return;
        }
        const status = res.statusCode ?? 0;
        if (status !== 200) {
          let body = "";
          res.on("data", (c) => (body += c.toString()));
          res.on("end", () => {
            this.opts.onError?.(new Error(`SSE ${status}: ${body.slice(0, 200)}`));
            // 401/403 won't self-heal by retry alone, but caller may refresh creds.
            this.scheduleReconnect(`http ${status}`, generation);
          });
          return;
        }
        this.backoff = this.opts.minBackoffMs; // reset on a good connection
        this.opts.onOpen?.(status);

        const encoding = (res.headers["content-encoding"] || "").toLowerCase();
        const source =
          this.opts.gzip && encoding.includes("gzip") ? res.pipe(zlib.createGunzip()) : res;

        this.parse(source, generation);
        source.on("end", () => this.scheduleReconnect("stream end", generation));
        source.on("error", (e) => {
          this.opts.onError?.(e as Error);
          this.scheduleReconnect("stream error", generation);
        });
        res.on("aborted", () => this.scheduleReconnect("aborted", generation));
      },
    );
    req.on("error", (e) => {
      if (this.stopped || generation !== this.generation) return;
      this.opts.onError?.(e);
      this.scheduleReconnect(`req error: ${e.message}`, generation);
    });
    this.req = req;
    req.end();
  }

  /** Incremental SSE parser over a (decompressed) byte stream. */
  private parse(stream: NodeJS.ReadableStream, generation: number): void {
    let buf = "";
    let dataLines: string[] = [];
    let event = "message";
    let id: string | null = null;

    const dispatch = () => {
      if (this.stopped || generation !== this.generation) return;
      if (dataLines.length === 0 && event === "message" && id === null) return;
      if (dataLines.length > 0 || event !== "message") {
        if (id !== null) this.lastEventId = id;
        this.opts.onMessage({ id, event, data: dataLines.join("\n") });
      }
      dataLines = [];
      event = "message";
      id = null;
    };

    stream.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let idx: number;
      // SSE lines are separated by \n; events by a blank line.
      while ((idx = buf.indexOf("\n")) >= 0) {
        let line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          dispatch();
          continue;
        }
        if (line.startsWith(":")) continue; // comment/keep-alive
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        switch (field) {
          case "data":
            dataLines.push(value);
            break;
          case "event":
            event = value;
            break;
          case "id":
            id = value;
            break;
          case "retry":
            break;
          default:
            break;
        }
      }
    });
  }
}
