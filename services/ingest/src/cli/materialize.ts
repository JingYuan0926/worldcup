#!/usr/bin/env -S npx tsx
/** Build a deterministic, self-contained one-row-per-second replay dataset. */
import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { loadConfig } from "../config.js";
import {
  foldReplayState,
  type CumulativeReplayState,
} from "../ingest/materialize-state.js";
import type { RecordedEnvelope } from "../replay.js";
import type { NetworkName } from "../txline/networks.js";
import { logger } from "../util/log.js";

const log = logger("cli:materialize");
const TERMINAL = new Set([5, 10, 13, 15, 16, 19]);

type Rec = Record<string, unknown>;
type Source = "live" | "historical";

interface Frame {
  source: Source;
  sourceLine: number;
  recvMs: number;
  payload: Rec;
  fixtureId: number;
  seq: number;
  ts: number;
  startTime: number;
  phase: number;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function pick(obj: Rec, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
    const found = Object.keys(obj).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (found) return obj[found];
  }
  return undefined;
}

function numberOf(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function readFrames(file: string, source: Source): Frame[] {
  if (!existsSync(file)) return [];
  // A single read snapshots the currently appended file. A truncated final line
  // is skipped; every complete earlier line remains immutable ground truth.
  const lines = readFileSync(file, "utf8").split("\n");
  const frames: Frame[] = [];
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    let envelope: RecordedEnvelope;
    try {
      envelope = JSON.parse(line) as RecordedEnvelope;
    } catch {
      if (index !== lines.length - 1) throw new Error(`${file}:${index + 1} is malformed`);
      return;
    }
    if (envelope.event === "heartbeat" || !envelope.data) return;
    let payload: Rec;
    try {
      payload = JSON.parse(envelope.data) as Rec;
    } catch {
      throw new Error(`${file}:${index + 1} has invalid data JSON`);
    }
    const fixtureId = numberOf(pick(payload, "FixtureId", "fixtureId"));
    const seq = numberOf(pick(payload, "Seq", "seq"));
    const ts = numberOf(pick(payload, "Ts", "ts", "timestamp")) || envelope.recvMs;
    const startTime = numberOf(pick(payload, "StartTime", "startTime"));
    const phase = numberOf(pick(payload, "StatusId", "statusSoccerId", "phase"));
    if (!fixtureId || !seq || !ts) return;
    frames.push({ source, sourceLine: index + 1, recvMs: envelope.recvMs, payload, fixtureId, seq, ts, startTime, phase });
  });
  return frames;
}

function canonicalize(frames: Frame[], fixtureId: number): { frames: Frame[]; duplicates: number } {
  const bySeq = new Map<number, Frame>();
  let duplicates = 0;
  for (const frame of frames) {
    if (frame.fixtureId !== fixtureId) throw new Error(`wrong fixture ${frame.fixtureId} at seq ${frame.seq}`);
    const existing = bySeq.get(frame.seq);
    if (!existing) {
      bySeq.set(frame.seq, frame);
      continue;
    }
    duplicates++;
    // Corrected post-match history wins overlap; otherwise keep the later receive.
    if (frame.source === "historical" && existing.source !== "historical") bySeq.set(frame.seq, frame);
    else if (frame.source === existing.source && frame.recvMs >= existing.recvMs) bySeq.set(frame.seq, frame);
  }
  return { frames: [...bySeq.values()].sort((a, b) => a.seq - b.seq), duplicates };
}

function atomicWrite(file: string, body: string): void {
  const temp = `${file}.tmp`;
  writeFileSync(temp, body);
  renameSync(temp, file);
}

function main(): void {
  const network = (arg("network") ?? process.env.TXLINE_NETWORK ?? "devnet") as NetworkName;
  const fixtureId = Number(arg("fixture") ?? process.env.WC_QF_FIXTURE_ID);
  const allowPartial = flag("allow-partial");
  if (!Number.isFinite(fixtureId)) throw new Error("--fixture is required");

  const cfg = loadConfig(network);
  const dir = resolve(cfg.recordingsDir, network, String(fixtureId));
  const liveFile = resolve(dir, "scores.ndjson");
  const historicalFile = resolve(dir, "historical.ndjson");
  const sourceFrames = [
    ...readFrames(liveFile, "live"),
    ...readFrames(historicalFile, "historical"),
  ];
  if (!sourceFrames.length) throw new Error(`no score frames found in ${dir}`);

  const canonical = canonicalize(sourceFrames, fixtureId);
  const frames = canonical.frames;
  const kickoff = frames.map((frame) => frame.startTime).find((value) => value > 0);
  if (!kickoff) throw new Error("no StartTime found in score frames");
  const terminal = [...frames].reverse().find((frame) => TERMINAL.has(frame.phase));
  const endTs = terminal?.ts ?? Math.max(Date.now(), frames.at(-1)!.ts);
  const totalSeconds = Math.max(1, Math.ceil((endTs - kickoff) / 1000));
  const firstObservedSecond = Math.max(1, Math.floor((frames[0]!.ts - kickoff) / 1000) + 1);
  const unknownSeconds = firstObservedSecond - 1;

  if (!allowPartial && (!terminal || unknownSeconds > 0)) {
    throw new Error(
      `recording is incomplete: ${unknownSeconds} opening seconds unknown, terminal=${Boolean(terminal)}. ` +
        "Run historical backfill after the match, or pass --allow-partial for a preview.",
    );
  }

  let cursor = 0;
  let current: CumulativeReplayState | null = null;
  const rows: string[] = [];
  for (let second = 1; second <= totalSeconds; second++) {
    const fromTsMs = kickoff + (second - 1) * 1000;
    const toTsMsExclusive = fromTsMs + 1000;
    const updates: Frame[] = [];
    while (cursor < frames.length && frames[cursor]!.ts < toTsMsExclusive) {
      const frame = frames[cursor]!;
      current = foldReplayState(current, frame);
      updates.push(frame);
      cursor++;
    }
    const fill = updates.length ? "observed" : current ? "forward-filled" : "unknown";
    rows.push(JSON.stringify({
      schemaVersion: 1,
      fixtureId,
      second,
      fromTsMs,
      toTsMsExclusive,
      fill,
      state: current,
      updates: updates.map((frame) => ({
        seq: frame.seq,
        tsMs: frame.ts,
        source: frame.source,
        sourceLine: frame.sourceLine,
        action: pick(frame.payload, "Action", "action") ?? null,
        participant: pick(frame.payload, "Participant", "participant") ?? null,
        payload: frame.payload,
      })),
    }));
  }

  const output = resolve(dir, "timeline-1s.ndjson");
  atomicWrite(output, `${rows.join("\n")}\n`);
  const manifest = {
    schemaVersion: 1,
    fixtureId,
    network,
    generatedAt: new Date().toISOString(),
    method: "field-wise cumulative action frames, then one-second last observation carried forward",
    sources: [liveFile, historicalFile].filter(existsSync).map((file) => relative(cfg.repoRoot, file)),
    output: relative(cfg.repoRoot, output),
    canonicalFrames: frames.length,
    duplicatesRemoved: canonical.duplicates,
    kickoffTsMs: kickoff,
    endTsMs: endTs,
    totalSeconds,
    firstObservedSecond,
    unknownSeconds,
    terminalPhase: terminal?.phase ?? null,
    complete: unknownSeconds === 0 && Boolean(terminal),
  };
  atomicWrite(resolve(dir, "timeline-1s.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  log.info(`${rows.length} one-second rows → ${output}`);
  log.info(`complete=${manifest.complete} unknownOpeningSeconds=${unknownSeconds} terminal=${manifest.terminalPhase ?? "no"}`);
}

main();

if (flag("watch")) {
  log.info("watching active recording; refreshing one-second JSON every 10s (Ctrl-C to stop)");
  setInterval(() => {
    try {
      main();
    } catch (error) {
      log.warn(error instanceof Error ? error.message : String(error));
    }
  }, 10_000);
}
