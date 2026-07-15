/**
 * Ingest fan-out — the normalized bus + websocket broadcast (README §4 component 2).
 *
 * A single {@link IngestFanout} consumes a raw SSE frame source (the live
 * {@link import("./sse/reader.js").SseClient} or the offline
 * {@link import("./replay.js").Replayer}), normalizes each frame with the stat
 * ticker, tracks the previous state, and pushes two message kinds to every
 * connected websocket client (and to in-process listeners, since this is an
 * EventEmitter):
 *
 *   { type: "state", state: MatchState }   — the full latest snapshot
 *   { type: "event", event: LiveEvent }    — one discrete goal/corner/card
 *
 * On connect a client is sent the current state snapshot immediately, then the
 * buffered recent events so a late joiner can rebuild the timeline.
 *
 * Both the live SSE client and the Replayer take their per-frame callback in
 * their constructor, so this class takes a `createSource(onFrame)` FACTORY rather
 * than a pre-built source: that resolves the wiring uniformly for either source
 * (the CLI just returns the right one). Frames can also be pushed directly via
 * {@link IngestFanout.ingest} if a caller prefers to wire the source itself.
 */
import { EventEmitter } from "node:events";
import { WebSocketServer, WebSocket } from "ws";
import type { SseMessage } from "./sse/reader.js";
import { deriveState, diffEvents, type LiveEvent, type MatchState } from "./ingest/ticker.js";
import { logger } from "./util/log.js";

const log = logger("fanout");

/** Anything with a start/stop lifecycle — SseClient and Replayer both qualify. */
export interface IngestSource {
  start(): void;
  stop(): void | Promise<void>;
}

export type FanoutMessage =
  | { type: "state"; state: MatchState }
  | { type: "event"; event: LiveEvent };

export interface IngestFanoutOptions {
  /** Fixture being served — for logging + the initial snapshot only. */
  fixtureId?: number;
  /** websocket port. Ignored if `wss` is supplied. */
  port?: number;
  /** Bind host (default all interfaces). Ignored if `wss` is supplied. */
  host?: string;
  /**
   * Build the frame source, wiring its per-frame callback to this fan-out. Called
   * once on {@link IngestFanout.start}. Omit if you will push frames via
   * {@link IngestFanout.ingest} yourself.
   */
  createSource?: (onFrame: (msg: SseMessage) => void) => IngestSource;
  /** Reuse an existing ws server instead of opening one. */
  wss?: WebSocketServer;
  /** How many recent events to replay to a freshly connected client. Default 64. */
  replayBuffer?: number;
}

/** Snapshot returned by {@link IngestFanout.getSnapshot} (drives the CLI status line). */
export interface FanoutSnapshot {
  state: MatchState | null;
  events: LiveEvent[];
  clients: number;
}

export class IngestFanout extends EventEmitter {
  readonly fixtureId?: number;
  private readonly ownWss: boolean;
  private wss: WebSocketServer | null;
  private readonly port?: number;
  private readonly host?: string;
  private readonly createSource?: (onFrame: (msg: SseMessage) => void) => IngestSource;
  private readonly replayBuffer: number;

  private source: IngestSource | null = null;
  private readonly clients = new Set<WebSocket>();
  private state: MatchState | null = null;
  private recentEvents: LiveEvent[] = [];
  private started = false;

  constructor(opts: IngestFanoutOptions = {}) {
    super();
    this.fixtureId = opts.fixtureId;
    this.port = opts.port;
    this.host = opts.host;
    this.createSource = opts.createSource;
    this.replayBuffer = opts.replayBuffer ?? 64;
    this.wss = opts.wss ?? null;
    this.ownWss = !opts.wss;
  }

  /** Latest normalized state, or null before the first frame. */
  getSnapshot(): FanoutSnapshot {
    return { state: this.state, events: [...this.recentEvents], clients: this.clients.size };
  }

  /** Number of currently connected websocket clients. */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Open the websocket server and start the frame source. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;

    if (!this.wss) {
      this.wss = new WebSocketServer({ port: this.port ?? 8787, host: this.host });
      this.wss.on("listening", () =>
        log.info(`websocket listening on ws://${this.host ?? "localhost"}:${this.port ?? 8787}`),
      );
      this.wss.on("error", (e) => log.error("wss error", (e as Error).message));
    }
    this.wss.on("connection", (ws) => this.onConnect(ws));

    if (this.createSource) {
      this.source = this.createSource((msg) => this.ingest(msg));
      this.source.start();
    }
  }

  /** Stop the source and close the server (only if this instance owns it). */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    try {
      await this.source?.stop();
    } catch (e) {
      log.warn("source stop failed", (e as Error).message);
    }
    for (const ws of this.clients) ws.close();
    this.clients.clear();
    if (this.ownWss && this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
      this.wss = null;
    }
  }

  /**
   * Ingest one raw SSE frame: normalize, diff against the previous state, then
   * broadcast a `state` message plus one `event` message per discrete change.
   * Heartbeats and unparseable frames are ignored. Safe to call directly.
   */
  ingest(msg: SseMessage): void {
    if (msg.event === "heartbeat") return;
    if (!msg.data || msg.data.trim() === "") return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(msg.data);
    } catch {
      log.warn(`dropping unparseable frame (${msg.data.length}b)`);
      return;
    }

    const next = deriveState(parsed);
    const prev = this.state;
    // No backwards-seq guard: the SSE reader delivers frames in order, and on a
    // looped replay the cursor legitimately resets (seq 15 → 1). diffEvents only
    // emits on an increase, so a reset re-broadcasts state with zero spurious
    // events, then re-fires them as the pass replays.
    const events = diffEvents(prev, next);
    this.state = next;

    this.broadcast({ type: "state", state: next });
    this.emit("state", next);

    for (const event of events) {
      this.recentEvents.push(event);
      if (this.recentEvents.length > this.replayBuffer) this.recentEvents.shift();
      this.broadcast({ type: "event", event });
      this.emit("event", event);
    }
  }

  private onConnect(ws: WebSocket): void {
    this.clients.add(ws);
    log.info(`client connected (${this.clients.size} total)`);
    // Snapshot: current state first, then buffered events so a late joiner can
    // rebuild the timeline before live updates start flowing.
    if (this.state) this.send(ws, { type: "state", state: this.state });
    for (const event of this.recentEvents) this.send(ws, { type: "event", event });

    ws.on("close", () => {
      this.clients.delete(ws);
      log.info(`client disconnected (${this.clients.size} total)`);
    });
    ws.on("error", (e) => log.warn("client error", (e as Error).message));
  }

  private broadcast(msg: FanoutMessage): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
        } catch (e) {
          log.warn("broadcast send failed", (e as Error).message);
        }
      }
    }
    this.emit("message", msg);
  }

  private send(ws: WebSocket, msg: FanoutMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {
      log.warn("send failed", (e as Error).message);
    }
  }
}
