import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import type { SseMessage } from "./sse/reader.js";
import { logger } from "./util/log.js";

const log = logger("replay");

/**
 * One recorded envelope line, exactly as `record.ts` writes it:
 * `{recvMs, recvIso, id, event, data}` where `data` is the verbatim SSE payload
 * string (a Scores JSON string for the scores stream, "" for heartbeats).
 */
export interface RecordedEnvelope {
  recvMs: number;
  recvIso: string;
  id: string | null;
  event: string;
  data: string;
}

export interface ReplayOptions {
  /** Path to a recorded ndjson file. */
  file: string;
  /** Playback speed multiplier: 1 (real time), 20, 60, … Default 1. */
  speed?: number;
  /** Restart from the top when the file ends (until `stop()`). Default false. */
  loop?: boolean;
  /**
   * Deliver `event: heartbeat` frames too (mirrors the live feed, which pushes
   * heartbeats through the same onMessage path). Default false — most consumers
   * only care about data frames. Timing is honored either way.
   */
  emitHeartbeats?: boolean;
  /**
   * Cap on any single inter-frame sleep (ms), applied AFTER the speed divide.
   * Real matches have long quiet gaps; without a cap even 60× playback would
   * stall for many seconds. Default 3000.
   */
  maxSleepMs?: number;
  /** Per-frame sink. Receives the same {id, event, data} shape as the live SSE reader. */
  onMessage?: (msg: SseMessage) => void;
  /** Called once when playback finishes (non-loop end) or after `stop()`. */
  onEnd?: (stats: ReplayStats) => void;
}

export interface ReplayStats {
  file: string;
  /** SseMessages delivered to onMessage / 'message' listeners. */
  delivered: number;
  /** Heartbeat frames encountered while `emitHeartbeats` was false. */
  heartbeatsSkipped: number;
  /** Number of full passes over the file (>1 only when looping). */
  passes: number;
  /** True if playback ended because `stop()` was called. */
  stopped: boolean;
}

/**
 * Replays a recorded ndjson file behind the SAME interface as the live SSE feed:
 * it re-emits {@link SseMessage} objects via an `onMessage` callback AND as
 * `'message'` events (this class is an EventEmitter), so the ingest fan-out can
 * consume a live stream or a replay identically.
 *
 * Inter-frame timing is derived from the recorded `recvMs` deltas, divided by
 * `speed` and clamped to `maxSleepMs`. `start()` / `stop()` are idempotent.
 *
 * Events: `'message'` (SseMessage), `'end'` (ReplayStats), `'error'` (Error).
 */
export class Replayer extends EventEmitter {
  readonly file: string;
  private readonly speed: number;
  private readonly loop: boolean;
  private readonly emitHeartbeats: boolean;
  private readonly maxSleepMs: number;
  private readonly onMessage?: (msg: SseMessage) => void;
  private readonly onEnd?: (stats: ReplayStats) => void;
  private readonly envelopes: RecordedEnvelope[];

  private running = false;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private wake: (() => void) | null = null;

  private delivered = 0;
  private heartbeatsSkipped = 0;
  private passes = 0;

  constructor(opts: ReplayOptions) {
    super();
    this.speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
    this.loop = opts.loop ?? false;
    this.emitHeartbeats = opts.emitHeartbeats ?? false;
    this.maxSleepMs = opts.maxSleepMs ?? 3000;
    this.onMessage = opts.onMessage;
    this.onEnd = opts.onEnd;
    this.file = opts.file;
    this.envelopes = Replayer.load(opts.file);
  }

  /** Total frames (data + heartbeat) in the loaded file. */
  get frameCount(): number {
    return this.envelopes.length;
  }

  /** Parse an ndjson recording into envelopes, skipping blank/malformed lines. */
  static load(file: string): RecordedEnvelope[] {
    if (!existsSync(file)) throw new Error(`recording not found: ${file}`);
    const out: RecordedEnvelope[] = [];
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw || raw.trim() === "") continue;
      let env: unknown;
      try {
        env = JSON.parse(raw);
      } catch {
        log.warn(`skipping malformed line ${i + 1} in ${file}`);
        continue;
      }
      if (!isEnvelope(env)) {
        log.warn(`skipping non-envelope line ${i + 1} in ${file}`);
        continue;
      }
      out.push(env);
    }
    if (out.length === 0) throw new Error(`recording has no usable frames: ${file}`);
    return out;
  }

  /** Begin (or resume) playback. No-op if already running. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    void this.run();
  }

  /** Stop playback; cancels any pending inter-frame sleep and fires `onEnd`/`'end'`. */
  stop(): void {
    if (!this.running) return;
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.wake) {
      const w = this.wake;
      this.wake = null;
      w();
    }
  }

  private async run(): Promise<void> {
    try {
      do {
        this.passes++;
        let prevRecvMs: number | null = null;
        for (const env of this.envelopes) {
          if (this.stopped) break;
          if (prevRecvMs !== null) {
            const gap = (env.recvMs - prevRecvMs) / this.speed;
            await this.sleep(clamp(gap, 0, this.maxSleepMs));
            if (this.stopped) break;
          }
          prevRecvMs = env.recvMs;
          if (env.event === "heartbeat" && !this.emitHeartbeats) {
            this.heartbeatsSkipped++;
            continue;
          }
          const msg: SseMessage = { id: env.id, event: env.event, data: env.data };
          this.delivered++;
          this.onMessage?.(msg);
          this.emit("message", msg);
        }
      } while (this.loop && !this.stopped);
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.running = false;
      const stats: ReplayStats = {
        file: this.file,
        delivered: this.delivered,
        heartbeatsSkipped: this.heartbeatsSkipped,
        passes: this.passes,
        stopped: this.stopped,
      };
      this.onEnd?.(stats);
      this.emit("end", stats);
    }
  }

  /** Cancellable sleep — `stop()` resolves it early. */
  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.wake = resolve;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.wake = null;
        resolve();
      }, ms);
    });
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function isEnvelope(v: unknown): v is RecordedEnvelope {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.recvMs === "number" &&
    typeof e.event === "string" &&
    typeof e.data === "string" &&
    (e.id === null || typeof e.id === "string")
  );
}
