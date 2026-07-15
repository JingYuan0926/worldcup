import { createWriteStream, mkdirSync, readFileSync, existsSync, type WriteStream } from "node:fs";
import { resolve } from "node:path";
import { SseClient, type SseMessage } from "./sse/reader.js";
import { TxlineClient } from "./txline/client.js";
import { logger } from "./util/log.js";

const log = logger("record");

/**
 * One recorded stream (scores or odds) → an append-only ndjson file.
 * Each line is an envelope `{recvMs, recvIso, id, event, data}` where `data`
 * is the verbatim SSE payload string — the ground-truth frame for replay.
 */
class StreamRecorder {
  private readonly file: WriteStream;
  private readonly cursorPath: string;
  private client: SseClient | null = null;
  frames = 0;
  dataFrames = 0;
  lastId: string | null = null;

  constructor(
    readonly label: string,
    dir: string,
    private readonly streamUrl: string,
    private readonly txline: TxlineClient,
  ) {
    this.file = createWriteStream(resolve(dir, `${label}.ndjson`), { flags: "a" });
    this.cursorPath = resolve(dir, `${label}.cursor`);
  }

  private readCursor(): string | null {
    if (existsSync(this.cursorPath)) return readFileSync(this.cursorPath, "utf8").trim() || null;
    return null;
  }

  start(): void {
    const resumeFrom = this.readCursor();
    if (resumeFrom) log.info(`[${this.label}] resuming from Last-Event-ID ${resumeFrom}`);
    this.client = new SseClient({
      url: this.streamUrl,
      headers: this.txline.dataHeaders(),
      lastEventId: resumeFrom,
      gzip: true,
      onOpen: () => log.info(`[${this.label}] stream open`),
      onError: (e) => log.warn(`[${this.label}] ${e.message}`),
      onMessage: (msg) => this.onMessage(msg),
    });
    this.client.start();
  }

  private onMessage(msg: SseMessage): void {
    const recvMs = Date.now();
    const line =
      JSON.stringify({
        recvMs,
        recvIso: new Date(recvMs).toISOString(),
        id: msg.id,
        event: msg.event,
        data: msg.data,
      }) + "\n";
    this.file.write(line);
    this.frames++;
    if (msg.event !== "heartbeat") this.dataFrames++;
    if (msg.id) {
      this.lastId = msg.id;
      // Persist cursor best-effort (small, frequent — fine for a recorder).
      try {
        createWriteStream(this.cursorPath, { flags: "w" }).end(msg.id);
      } catch {
        /* ignore */
      }
    }
  }

  stop(): Promise<void> {
    this.client?.stop();
    return new Promise((r) => this.file.end(r));
  }
}

export interface RecordOptions {
  fixtureId: number;
  /** also record the odds stream (best-effort; feed shape less documented). */
  recordOdds?: boolean;
  /** override base recordings dir. */
  outBaseDir: string;
}

export class RecorderSession {
  private readonly dir: string;
  private readonly recorders: StreamRecorder[] = [];
  private statsTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly txline: TxlineClient,
    private readonly opts: RecordOptions,
  ) {
    this.dir = resolve(opts.outBaseDir, txline.network.name, String(opts.fixtureId));
    mkdirSync(this.dir, { recursive: true });
  }

  start(): void {
    const { fixtureId } = this.opts;
    const origin = this.txline.origin;

    writeMeta(this.dir, {
      fixtureId,
      network: this.txline.network.name,
      startedAt: new Date().toISOString(),
      streams: {
        scores: `${origin}/api/scores/stream?fixtureId=${fixtureId}`,
        odds: this.opts.recordOdds ? `${origin}/api/odds/stream?fixtureId=${fixtureId}` : null,
      },
    });

    this.recorders.push(
      new StreamRecorder(
        "scores",
        this.dir,
        `${origin}/api/scores/stream?fixtureId=${fixtureId}`,
        this.txline,
      ),
    );
    if (this.opts.recordOdds) {
      this.recorders.push(
        new StreamRecorder(
          "odds",
          this.dir,
          `${origin}/api/odds/stream?fixtureId=${fixtureId}`,
          this.txline,
        ),
      );
    }

    for (const r of this.recorders) r.start();
    log.info(`recording fixture ${fixtureId} (${this.txline.network.name}) → ${this.dir}`);

    this.statsTimer = setInterval(() => {
      const summary = this.recorders
        .map((r) => `${r.label}=${r.frames}(${r.dataFrames} data)`)
        .join("  ");
      log.info(`frames: ${summary}  lastId=${this.recorders[0]?.lastId ?? "-"}`);
    }, 30_000);
    this.statsTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.statsTimer) clearInterval(this.statsTimer);
    await Promise.all(this.recorders.map((r) => r.stop()));
    log.info("recorder stopped, files flushed");
  }
}

function writeMeta(dir: string, meta: unknown): void {
  createWriteStream(resolve(dir, "meta.json"), { flags: "w" }).end(JSON.stringify(meta, null, 2));
}
