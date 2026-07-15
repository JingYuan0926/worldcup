#!/usr/bin/env -S npx tsx
/**
 * Ingest fan-out server (README §4 component 2; TASKS Phase 2).
 *
 * Serves the normalized match state + live event stream to the web app over a
 * websocket, driven either by a live TxLINE SSE stream or by an offline replay
 * of a recorded match.
 *
 *   # offline — works NOW, no tokens needed (bundled sample fallback):
 *   npm run serve -- --replay --fixture 18209181 --network mainnet --speed 30
 *   npm run serve -- --replay --file recordings/mainnet/18209181/scores.ndjson --loop
 *
 *   # live — needs a saved token (prints an auth hint + exits 0 without one):
 *   npm run serve -- --fixture 18209181 --network devnet --port 8787
 *
 * Flags: --fixture <id> --network <name> --port <n> (default 8787)
 *        --replay  drive from a recording instead of live SSE
 *        --speed <x>  replay speed multiplier (default 20)
 *        --loop  restart the recording when it ends (replay only)
 *        --file <path>  explicit recording (replay only; else per-fixture/sample)
 *
 * The websocket emits JSON messages: {type:"state",state} and {type:"event",event}.
 * Ctrl-C to stop.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { IngestFanout, type IngestSource } from "../fanout.js";
import { Replayer } from "../replay.js";
import { SseClient, type SseMessage } from "../sse/reader.js";
import { TxlineClient } from "../txline/client.js";
import { loadTokens } from "../util/tokens.js";
import type { NetworkName } from "../txline/networks.js";
import { logger } from "../util/log.js";
import type { MatchState } from "../ingest/ticker.js";

const log = logger("cli:serve");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** README §7.4 game phases, id → short label (mirrors cli/replay.ts). */
const PHASE: Record<number, string> = {
  1: "NS", 2: "H1", 3: "HT", 4: "H2", 5: "F", 6: "WET", 7: "ET1", 8: "HTET", 9: "ET2",
  10: "FET", 11: "WPE", 12: "PE", 13: "FPE", 14: "I", 15: "A", 16: "C", 17: "TXCC",
  18: "TXCS", 19: "P",
};

function summarizeState(s: MatchState | null): string {
  if (!s) return "no frames yet";
  const phase = PHASE[s.phase] ?? `#${s.phase}`;
  return (
    `seq ${s.seq} ${phase} ${String(s.clockMinute).padStart(2)}'  ` +
    `${s.home.goals}-${s.away.goals}  ` +
    `corners ${s.home.corners}-${s.away.corners}  ` +
    `cards Y${s.home.yellows + s.away.yellows}/R${s.home.reds + s.away.reds}`
  );
}

/** Resolve a recording path like cli/replay.ts: --file, else per-fixture, else bundled sample. */
function resolveRecording(repoRoot: string, recordingsDir: string, network: string, fixtureId: string): string | null {
  const explicit = arg("file");
  if (explicit) {
    const f = resolve(repoRoot, explicit);
    if (!existsSync(f)) {
      log.error(`--file not found: ${f}`);
      return null;
    }
    return f;
  }
  const preferred = resolve(recordingsDir, network, fixtureId, "scores.ndjson");
  const sample = resolve(recordingsDir, "sample", network, fixtureId, "scores.ndjson");
  if (existsSync(preferred)) return preferred;
  if (existsSync(sample)) {
    log.warn(`no live recording at ${preferred}`);
    log.info(`falling back to bundled sample: ${sample}`);
    return sample;
  }
  log.error(`no recording for fixture ${fixtureId} (${network}) and no bundled sample.`);
  return null;
}

function main(): void {
  const network = (arg("network") ?? process.env.TXLINE_NETWORK ?? "mainnet") as NetworkName;
  const fixtureId = arg("fixture") ?? "18209181";
  const port = Number(arg("port") ?? "8787");
  const replay = flag("replay");
  const speed = Number(arg("speed") ?? "20");
  const loop = flag("loop");

  const cfg = loadConfig(network);

  // Build the frame-source factory for either the replay or the live path.
  let createSource: (onFrame: (msg: SseMessage) => void) => IngestSource;

  if (replay) {
    const file = resolveRecording(cfg.repoRoot, cfg.recordingsDir, network, fixtureId);
    if (!file) {
      process.exit(1);
      return;
    }
    log.info(`replay source: ${file} at ${speed}× (loop=${loop})`);
    createSource = (onFrame) => {
      const replayer = new Replayer({
        file,
        speed,
        loop,
        onMessage: onFrame,
        onEnd: (s) =>
          log.info(
            `replay ended: ${s.delivered} frames, ${s.passes} pass(es)` +
              `${loop ? "" : " — ws server still serving final snapshot (Ctrl-C to exit)"}`,
          ),
      });
      log.info(`loaded ${replayer.frameCount} frames`);
      return replayer;
    };
  } else {
    // Live path needs a saved token; exit 0 with a hint if absent (mirrors probe.ts).
    const tokens = loadTokens(cfg.tokensDir, network);
    if (!tokens) {
      log.warn(`No saved TxLINE tokens for ${network} in ${cfg.tokensDir}.`);
      log.info(`Authenticate first, then re-run, or use offline replay now:`);
      log.info(`    npm run auth  -- --network ${network}`);
      log.info(`    npm run serve -- --replay --fixture ${fixtureId} --network ${network}`);
      process.exit(0);
      return;
    }
    const client = TxlineClient.fromTokens(tokens);
    const url = `${client.origin}/api/scores/stream?fixtureId=${fixtureId}`;
    log.info(`live source: ${url}`);
    createSource = (onFrame) => {
      const sse = new SseClient({
        url,
        headers: client.dataHeaders(),
        gzip: true,
        onMessage: onFrame,
        onOpen: () => log.info("SSE stream open"),
        onError: (e) => log.warn(`SSE ${e.message}`),
      });
      return { start: () => sse.start(), stop: () => sse.stop() };
    };
  }

  const fanout = new IngestFanout({ fixtureId: Number(fixtureId), port, createSource });

  fanout.on("event", (e) =>
    log.info(`event ${e.kind} ${e.side} → bucket ${e.bucket} (team #${e.count}, match #${e.total}) @ ${e.clockMinute}'`),
  );

  const status = setInterval(() => {
    const snap = fanout.getSnapshot();
    log.info(`clients=${snap.clients}  ${summarizeState(snap.state)}`);
  }, 5000);
  status.unref?.();

  let stopping = false;
  const shutdown = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    clearInterval(status);
    log.info(`${sig} received — shutting down…`);
    await fanout.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  fanout.start();
  log.info(`ingest fan-out live on port ${port} (fixture ${fixtureId}, ${network}). Ctrl-C to stop.`);
}

main();
