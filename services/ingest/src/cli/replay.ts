#!/usr/bin/env -S npx tsx
/**
 * SSE replayer CLI (Phase 0). Re-emits a recorded match behind the same
 * interface as the live feed — powers the demo video and CI replay tests.
 *
 *   npm run replay -- --fixture 18209181 --network mainnet --speed 20
 *   npm run replay -- --fixture 18209181 --network mainnet --speed 60 --stream scores
 *   npm run replay -- --file recordings/mainnet/18209181/scores.ndjson --loop
 *
 * Input path defaults to recordings/<network>/<fixtureId>/<stream>.ndjson; if
 * that file is absent it falls back to the bundled sample under
 * recordings/sample/... so the command always runs (no tokens needed — replay
 * reads local files only).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { Replayer, type ReplayStats } from "../replay.js";
import type { SseMessage } from "../sse/reader.js";
import { deriveState } from "../ingest/ticker.js";
import type { NetworkName } from "../txline/networks.js";
import { logger } from "../util/log.js";

const log = logger("cli:replay");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** README §7.4 game phases, id → short label. */
const PHASE: Record<number, string> = {
  1: "NS",
  2: "H1",
  3: "HT",
  4: "H2",
  5: "F",
  6: "WET",
  7: "ET1",
  8: "HTET",
  9: "ET2",
  10: "FET",
  11: "WPE",
  12: "PE",
  13: "FPE",
  14: "I",
  15: "A",
  16: "C",
  17: "TXCC",
  18: "TXCS",
  19: "P",
};

/** Compact one-line summary of a scores frame; falls back to raw on parse failure. */
function summarize(msg: SseMessage): string {
  if (msg.event === "heartbeat") return "♥ heartbeat";
  let parsed: unknown;
  try {
    parsed = JSON.parse(msg.data);
  } catch {
    return `[unparseable ${msg.data.length}b] ${msg.data.slice(0, 60)}`;
  }
  const state = deriveState(parsed);
  const phase = state.phase ? (PHASE[state.phase] ?? `#${state.phase}`) : "?";
  const clock = `${state.clockMinute}'`;
  const seq = String(state.seq || "?").padStart(3);
  return `seq ${seq}  ${phase.padEnd(4)} ${clock.padStart(5)}  ${state.home.goals}-${state.away.goals}`;
}

function main(): void {
  const network = (arg("network") ?? process.env.TXLINE_NETWORK ?? "mainnet") as NetworkName;
  const stream = arg("stream") ?? "scores";
  const speed = Number(arg("speed") ?? "1");
  const loop = flag("loop");
  const emitHeartbeats = flag("heartbeats");
  const fixtureArg = arg("fixture");

  const cfg = loadConfig(network);

  // Resolve the recording: explicit --file wins; else the per-fixture recording;
  // else the bundled sample so the command always runs.
  const explicit = arg("file");
  let file: string;
  if (explicit) {
    file = resolve(cfg.repoRoot, explicit);
    if (!existsSync(file)) {
      log.error(`--file not found: ${file}`);
      process.exit(1);
    }
  } else {
    const fixtureId = fixtureArg ?? "18209181";
    const preferred = resolve(cfg.recordingsDir, network, fixtureId, `${stream}.ndjson`);
    const sample = resolve(cfg.recordingsDir, "sample", network, fixtureId, `${stream}.ndjson`);
    if (existsSync(preferred)) {
      file = preferred;
    } else if (existsSync(sample)) {
      log.warn(`no live recording at ${preferred}`);
      log.info(`falling back to bundled sample: ${sample}`);
      file = sample;
    } else {
      log.error(`no recording for fixture ${fixtureId} (${network}/${stream}) and no bundled sample.`);
      log.error(`record one first: npm run record -- --fixture ${fixtureId} --network ${network}`);
      process.exit(1);
      return;
    }
  }

  log.info(
    `replaying ${file} at ${speed}× (stream=${stream}, loop=${loop}, heartbeats=${emitHeartbeats})`,
  );

  const replayer = new Replayer({
    file,
    speed,
    loop,
    emitHeartbeats,
    onMessage: (msg) => log.info(summarize(msg)),
    onEnd: (s: ReplayStats) => {
      log.info(
        `done: ${s.delivered} frames delivered, ${s.heartbeatsSkipped} heartbeats skipped, ` +
          `${s.passes} pass(es)${s.stopped ? " (stopped)" : ""}`,
      );
      process.exit(0);
    },
  });

  log.info(`loaded ${replayer.frameCount} frames`);

  const shutdown = (sig: string) => {
    log.info(`${sig} received — stopping replay…`);
    replayer.stop();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  replayer.start();
}

main();
