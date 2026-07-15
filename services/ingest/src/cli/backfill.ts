#!/usr/bin/env -S npx tsx
/**
 * Backfill replay test data from finished fixtures (TASKS Phase 0 "Backfill";
 * README §7.3 `GET /api/scores/historical/{fixtureId}`, valid 6h–2weeks after start).
 *
 *   npm run backfill -- --network devnet --fixture 17588310
 *   npm run backfill -- --network devnet            # the known finished WC set
 *
 * Writes recordings/<network>/<fixtureId>/historical.ndjson in the SAME envelope
 * the live recorder uses, so the replayer can drive it identically. Also keeps the
 * raw response for wire-format inspection. No token → prints the auth hint, exits 0.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { TxlineClient } from "../txline/client.js";
import { loadTokens } from "../util/tokens.js";
import type { NetworkName } from "../txline/networks.js";
import { logger } from "../util/log.js";
import { parseSseTranscript } from "../sse/transcript.js";

const log = logger("cli:backfill");

// Finished WC fixtures for replay/test data (README §7.7).
const KNOWN_FINISHED = [17588310, 18172489, 18198205];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Pull an array of Scores frames out of whatever shape historical returns. */
function extractFrames(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    for (const key of ["frames", "scores", "updates", "records", "data", "items"]) {
      if (Array.isArray(o[key])) return o[key] as unknown[];
    }
  }
  // Single object → one frame.
  return body == null ? [] : [body];
}

interface HistoricalFrame {
  id: string | null;
  event: string;
  data: string;
  payload: unknown;
}

function payloadFromData(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

/** Accept both the documented JSON response and TxLINE's observed SSE transcript. */
function decodeHistorical(raw: string): { format: "json" | "sse"; frames: HistoricalFrame[] } | null {
  try {
    const body = JSON.parse(raw) as unknown;
    const frames = extractFrames(body).map((frame) => {
      const data = typeof frame === "string" ? frame : JSON.stringify(frame);
      return {
        id: null,
        event: "message",
        data,
        payload: typeof frame === "string" ? payloadFromData(frame) : frame,
      };
    });
    return { format: "json", frames };
  } catch {
    const messages = parseSseTranscript(raw);
    if (messages.length === 0) return null;
    return {
      format: "sse",
      frames: messages.map((message) => ({
        ...message,
        payload: payloadFromData(message.data),
      })),
    };
  }
}

/** Best-effort ms timestamp from a frame (for replay timing + envelope id). */
function frameTs(frame: unknown, fallback: number): number {
  if (frame && typeof frame === "object") {
    const o = frame as Record<string, unknown>;
    for (const key of ["ts", "timestamp", "updateTime", "Ts"]) {
      const v = o[key];
      if (typeof v === "number" && v > 1_000_000_000_000) return v;
    }
  }
  return fallback;
}

async function backfillOne(client: TxlineClient, fixtureId: number, baseDir: string): Promise<void> {
  const dir = resolve(baseDir, client.network.name, String(fixtureId));
  mkdirSync(dir, { recursive: true });
  log.info(`fetching /api/scores/historical/${fixtureId}`);

  let raw: string;
  try {
    raw = await client.getText(`/api/scores/historical/${fixtureId}`);
  } catch (e) {
    log.warn(`historical ${fixtureId} failed: ${(e as Error).message}`);
    return;
  }
  writeFileSync(resolve(dir, "historical.raw.json"), raw);

  const decoded = decodeHistorical(raw);
  if (!decoded) {
    log.warn(
      `historical ${fixtureId} is neither JSON nor a usable SSE transcript ` +
        `(${raw.length} bytes) — kept raw only`,
    );
    return;
  }

  const { frames, format } = decoded;
  if (frames.length === 0) {
    log.warn(`historical ${fixtureId}: no frames extracted (kept raw for inspection)`);
    return;
  }

  const lines: string[] = [];
  let synthTs = Date.now() - frames.length * 60_000;
  frames.forEach((frame, index) => {
    const ts = frameTs(frame.payload, (synthTs += 60_000));
    lines.push(
      JSON.stringify({
        recvMs: ts,
        recvIso: new Date(ts).toISOString(),
        id: frame.id ?? `${ts}:${index}`,
        event: frame.event,
        data: frame.data,
      }),
    );
  });
  writeFileSync(resolve(dir, "historical.ndjson"), lines.join("\n") + "\n");
  writeFileSync(
    resolve(dir, "historical.meta.json"),
    JSON.stringify(
      {
        fixtureId,
        network: client.network.name,
        source: "historical-backfill",
        format,
        frames: frames.length,
        backfilledAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  log.info(`✅ ${fixtureId}: ${frames.length} ${format.toUpperCase()} frames → ${dir}/historical.ndjson`);
}

async function main(): Promise<void> {
  const network = (arg("network") ?? process.env.TXLINE_NETWORK ?? "devnet") as NetworkName;
  const cfg = loadConfig(network);

  if (!loadTokens(cfg.tokensDir, network)) {
    log.warn(`No ${network} TxLINE token yet. Run: npm run auth -- --network ${network}`);
    log.warn("(the subscribe tx is currently unfunded — backfill is ready to run once it lands)");
    process.exit(0);
  }

  const client = TxlineClient.fromSaved(cfg.tokensDir, network);
  const one = arg("fixture");
  const fixtures = one ? [Number(one)] : KNOWN_FINISHED;
  log.info(`backfilling ${fixtures.length} fixture(s) on ${network}: ${fixtures.join(", ")}`);
  for (const f of fixtures) await backfillOne(client, f, cfg.recordingsDir);
  log.info("backfill complete");
}

main().catch((e) => {
  log.error("fatal", e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
