#!/usr/bin/env -S npx tsx
/**
 * Persistent World Cup capture supervisor.
 *
 * It polls TxLINE's fixture snapshot, starts lossless scores + odds capture
 * before kickoff, keeps a one-second materialization refreshed, drains final
 * corrections after a terminal phase, and later retries historical backfill
 * until strict kickoff-to-terminal coverage is proven complete.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_HISTORICAL_DELAY_MS,
  DEFAULT_LOOKAHEAD_MS,
  DEFAULT_PRESTART_MS,
  TERMINAL_PHASES,
  WORLD_CUP_COMPETITION_ID,
  planWorldCupFixtures,
  type FixturePlan,
} from "../auto-record-plan.js";
import { loadConfig } from "../config.js";
import { TxlineClient } from "../txline/client.js";
import type { NetworkName } from "../txline/networks.js";
import { logger } from "../util/log.js";

const log = logger("cli:auto-record");
const DEFAULT_POLL_MS = 30_000;
const DEFAULT_DRAIN_MS = 120_000;
const DEFAULT_RETRY_MS = 15 * 60_000;
const RECORDING_LATE_WINDOW_MS = 4 * 60 * 60_000;
const CHILD_STOP_TIMEOUT_MS = 12_000;

type CaptureStage =
  | "armed"
  | "recording"
  | "draining"
  | "awaiting-backfill"
  | "finalizing"
  | "complete"
  | "error";

interface PersistedCapture {
  fixtureId: number;
  home: string;
  away: string;
  startTimeMs: number;
  recordAtMs: number;
  historicalAtMs: number;
  stage: CaptureStage;
  terminalSeenAtMs?: number;
  nextBackfillAtMs?: number;
  lastError?: string;
  updatedAtMs: number;
}

interface PersistedState {
  schemaVersion: 1;
  network: NetworkName;
  daemonPid: number;
  updatedAt: string;
  pollMs: number;
  prestartMs: number;
  drainMs: number;
  fixtures: PersistedCapture[];
}

interface CaptureJob extends PersistedCapture {
  recorder: ChildProcess | null;
  materializer: ChildProcess | null;
  stopping: boolean;
  finalizing: boolean;
  restartAfterMs: number;
}

interface Manifest {
  fixtureId?: number;
  terminalPhase?: number | null;
  complete?: boolean;
  unknownSeconds?: number;
  totalSeconds?: number;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function positiveNumber(name: string, fallback: number): number {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be positive`);
  return value;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function atomicJson(file: string, value: unknown): void {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, file);
}

function nonEmpty(file: string): boolean {
  try {
    return statSync(file).size > 0;
  } catch {
    return false;
  }
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(file: string): void {
  mkdirSync(resolve(file, ".."), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const descriptor = openSync(file, "wx", 0o600);
      writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
      closeSync(descriptor);
      return;
    } catch (error) {
      const existing = readJson<{ pid?: number }>(file);
      if (existing?.pid && pidAlive(existing.pid)) {
        throw new Error(`auto-recorder already running as pid ${existing.pid}`);
      }
      try {
        unlinkSync(file);
      } catch {
        /* another process may have removed a stale lock */
      }
      if (attempt === 1) throw error;
    }
  }
}

function releaseLock(file: string): void {
  const lock = readJson<{ pid?: number }>(file);
  if (lock?.pid !== process.pid) return;
  try {
    unlinkSync(file);
  } catch {
    /* best effort during shutdown */
  }
}

function manifestPath(recordingsDir: string, network: NetworkName, fixtureId: number): string {
  return resolve(recordingsDir, network, String(fixtureId), "timeline-1s.manifest.json");
}

function scorePath(recordingsDir: string, network: NetworkName, fixtureId: number): string {
  return resolve(recordingsDir, network, String(fixtureId), "scores.ndjson");
}

function historicalPath(recordingsDir: string, network: NetworkName, fixtureId: number): string {
  return resolve(recordingsDir, network, String(fixtureId), "historical.ndjson");
}

function recordingEvidence(recordingsDir: string, network: NetworkName, fixtureId: number): boolean {
  const directory = resolve(recordingsDir, network, String(fixtureId));
  return nonEmpty(resolve(directory, "scores.ndjson")) || existsSync(resolve(directory, "meta.json"));
}

function terminalManifest(manifest: Manifest | null): boolean {
  return typeof manifest?.terminalPhase === "number" && TERMINAL_PHASES.has(manifest.terminalPhase);
}

function jobFromPlan(plan: FixturePlan, current?: CaptureJob): CaptureJob {
  return {
    fixtureId: plan.fixtureId,
    home: plan.home,
    away: plan.away,
    startTimeMs: plan.startTimeMs,
    recordAtMs: plan.recordAtMs,
    historicalAtMs: plan.historicalAtMs,
    stage: current?.stage ?? "armed",
    terminalSeenAtMs: current?.terminalSeenAtMs,
    nextBackfillAtMs: current?.nextBackfillAtMs,
    lastError: current?.lastError,
    updatedAtMs: Date.now(),
    recorder: current?.recorder ?? null,
    materializer: current?.materializer ?? null,
    stopping: current?.stopping ?? false,
    finalizing: current?.finalizing ?? false,
    restartAfterMs: current?.restartAfterMs ?? 0,
  };
}

function persistedJob(value: PersistedCapture): CaptureJob {
  return {
    ...value,
    recorder: null,
    materializer: null,
    stopping: false,
    finalizing: false,
    restartAfterMs: 0,
  };
}

function publicJob(job: CaptureJob): PersistedCapture {
  return {
    fixtureId: job.fixtureId,
    home: job.home,
    away: job.away,
    startTimeMs: job.startTimeMs,
    recordAtMs: job.recordAtMs,
    historicalAtMs: job.historicalAtMs,
    stage: job.stage,
    terminalSeenAtMs: job.terminalSeenAtMs,
    nextBackfillAtMs: job.nextBackfillAtMs,
    lastError: job.lastError,
    updatedAtMs: job.updatedAtMs,
  };
}

function childArgs(script: "record" | "materialize" | "backfill", network: NetworkName, fixtureId: number): string[] {
  const base = ["run", script, "--workspace=@exact-match/ingest", "--", "--network", network, "--fixture", String(fixtureId)];
  if (script === "record") base.push("--odds");
  if (script === "materialize") base.push("--allow-partial", "--watch");
  return base;
}

function startChild(
  script: "record" | "materialize" | "backfill",
  network: NetworkName,
  fixtureId: number,
  cwd: string,
): ChildProcess {
  return spawn("npm", childArgs(script, network, fixtureId), {
    cwd,
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
    detached: process.platform !== "win32",
  });
}

function runOnce(args: string[], cwd: string): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn("npm", args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
      detached: process.platform !== "win32",
    });
    child.once("error", () => resolvePromise(1));
    child.once("exit", (code) => resolvePromise(code ?? 1));
  });
}

function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    /* already exited */
  }
}

function stopChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(force);
      resolvePromise();
    };
    child.once("exit", finish);
    signalChild(child, "SIGINT");
    const force = setTimeout(() => {
      signalChild(child, "SIGTERM");
      finish();
    }, CHILD_STOP_TIMEOUT_MS);
  });
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

async function main(): Promise<void> {
  const network = (arg("network") ?? process.env.TXLINE_NETWORK ?? "devnet") as NetworkName;
  const pollMs = positiveNumber("poll-seconds", DEFAULT_POLL_MS / 1_000) * 1_000;
  const lookaheadMs = positiveNumber("lookahead-hours", DEFAULT_LOOKAHEAD_MS / 3_600_000) * 3_600_000;
  const prestartMs = positiveNumber("lead-minutes", DEFAULT_PRESTART_MS / 60_000) * 60_000;
  const drainMs = positiveNumber("drain-seconds", DEFAULT_DRAIN_MS / 1_000) * 1_000;
  const retryMs = positiveNumber("retry-minutes", DEFAULT_RETRY_MS / 60_000) * 60_000;
  const historicalDelayMs = positiveNumber(
    "historical-delay-hours",
    DEFAULT_HISTORICAL_DELAY_MS / 3_600_000,
  ) * 3_600_000;
  const competitionId = positiveNumber("competition-id", WORLD_CUP_COMPETITION_ID);
  const dryRun = flag("dry-run") || flag("once");

  const config = loadConfig(network);
  const client = TxlineClient.fromSaved(config.tokensDir, network);
  const networkDir = resolve(config.recordingsDir, network);
  const stateFile = resolve(networkDir, "auto-capture-state.json");
  const lockFile = resolve(networkDir, "auto-capture.lock");
  mkdirSync(networkDir, { recursive: true });

  if (dryRun) {
    const snapshot = await client.getJson<unknown>(`/api/fixtures/snapshot?competitionId=${competitionId}`);
    const plans = planWorldCupFixtures(snapshot, {
      nowMs: Date.now(),
      lookaheadMs,
      prestartMs,
      historicalDelayMs,
      competitionId,
    });
    console.log(JSON.stringify(plans, null, 2));
    return;
  }

  acquireLock(lockFile);
  const jobs = new Map<number, CaptureJob>();
  const saved = readJson<PersistedState>(stateFile);
  if (saved?.network === network) {
    for (const fixture of saved.fixtures) jobs.set(fixture.fixtureId, persistedJob(fixture));
  }

  let shuttingDown = false;
  let ticking = false;

  const saveState = () => {
    const state: PersistedState = {
      schemaVersion: 1,
      network,
      daemonPid: process.pid,
      updatedAt: new Date().toISOString(),
      pollMs,
      prestartMs,
      drainMs,
      fixtures: [...jobs.values()]
        .sort((a, b) => a.startTimeMs - b.startTimeMs || a.fixtureId - b.fixtureId)
        .map(publicJob),
    };
    atomicJson(stateFile, state);
  };

  const wireChild = (job: CaptureJob, kind: "recorder" | "materializer", child: ChildProcess) => {
    child.once("error", (error) => {
      job.lastError = `${kind}: ${error.message}`;
      job.restartAfterMs = Date.now() + 30_000;
      job.updatedAtMs = Date.now();
      log.warn(`${job.fixtureId} ${job.lastError}`);
    });
    child.once("exit", (code, signal) => {
      if (job[kind] === child) job[kind] = null;
      if (!job.stopping && (job.stage === "recording" || job.stage === "draining")) {
        job.lastError = `${kind} exited unexpectedly (${signal ?? code ?? "unknown"})`;
        job.restartAfterMs = Date.now() + 30_000;
        log.warn(`${job.fixtureId} ${job.lastError}; resumable restart armed`);
      }
      job.updatedAtMs = Date.now();
      saveState();
    });
  };

  const ensureLiveChildren = (job: CaptureJob, now: number) => {
    if (job.stopping || now < job.restartAfterMs) return;
    if (!job.recorder) {
      job.recorder = startChild("record", network, job.fixtureId, config.repoRoot);
      wireChild(job, "recorder", job.recorder);
      log.info(`${job.fixtureId} ${job.home}–${job.away}: scores + odds recorder started`);
    }
    const scores = scorePath(config.recordingsDir, network, job.fixtureId);
    if (!job.materializer && nonEmpty(scores)) {
      job.materializer = startChild("materialize", network, job.fixtureId, config.repoRoot);
      wireChild(job, "materializer", job.materializer);
      log.info(`${job.fixtureId}: one-second materializer started`);
    }
  };

  const finishLive = async (job: CaptureJob) => {
    if (job.stopping) return;
    job.stopping = true;
    log.info(`${job.fixtureId}: terminal drain complete; flushing live files`);
    await Promise.all([stopChild(job.materializer), stopChild(job.recorder)]);
    job.materializer = null;
    job.recorder = null;
    job.stopping = false;
    job.stage = "awaiting-backfill";
    job.nextBackfillAtMs = Math.max(Date.now(), job.historicalAtMs);
    job.updatedAtMs = Date.now();
    saveState();
  };

  const finalizeHistorical = async (job: CaptureJob) => {
    if (job.finalizing || shuttingDown) return;
    job.finalizing = true;
    job.stage = "finalizing";
    job.updatedAtMs = Date.now();
    saveState();
    log.info(`${job.fixtureId}: requesting TxLINE historical replay`);
    try {
      const backfillExit = await runOnce(
        childArgs("backfill", network, job.fixtureId),
        config.repoRoot,
      );
      const historical = historicalPath(config.recordingsDir, network, job.fixtureId);
      if (backfillExit !== 0 || !nonEmpty(historical)) {
        throw new Error(`historical backfill unavailable (exit ${backfillExit})`);
      }
      const materializeArgs = [
        "run",
        "materialize",
        "--workspace=@exact-match/ingest",
        "--",
        "--network",
        network,
        "--fixture",
        String(job.fixtureId),
      ];
      const materializeExit = await runOnce(materializeArgs, config.repoRoot);
      const manifest = readJson<Manifest>(
        manifestPath(config.recordingsDir, network, job.fixtureId),
      );
      if (materializeExit !== 0 || !manifest?.complete) {
        throw new Error(`strict materialization incomplete (exit ${materializeExit})`);
      }
      job.stage = "complete";
      job.lastError = undefined;
      job.nextBackfillAtMs = undefined;
      log.info(
        `${job.fixtureId}: COMPLETE — ${manifest.totalSeconds ?? "?"} one-second rows, zero unknown opening seconds`,
      );
    } catch (error) {
      job.stage = "awaiting-backfill";
      job.lastError = error instanceof Error ? error.message : String(error);
      job.nextBackfillAtMs = Date.now() + retryMs;
      log.warn(`${job.fixtureId}: ${job.lastError}; retry at ${iso(job.nextBackfillAtMs)}`);
    } finally {
      job.finalizing = false;
      job.updatedAtMs = Date.now();
      saveState();
    }
  };

  const tick = async () => {
    if (ticking || shuttingDown) return;
    ticking = true;
    const now = Date.now();
    try {
      const completeIds = new Set<number>();
      for (const job of jobs.values()) {
        const manifest = readJson<Manifest>(
          manifestPath(config.recordingsDir, network, job.fixtureId),
        );
        if (manifest?.complete) completeIds.add(job.fixtureId);
      }

      const snapshot = await client.getJson<unknown>(
        `/api/fixtures/snapshot?competitionId=${competitionId}`,
      );
      const plans = planWorldCupFixtures(snapshot, {
        nowMs: now,
        lookaheadMs,
        prestartMs,
        historicalDelayMs,
        competitionId,
        completeFixtureIds: completeIds,
      });

      for (const plan of plans) {
        const existing = jobs.get(plan.fixtureId);
        const job = jobFromPlan(plan, existing);
        jobs.set(plan.fixtureId, job);

        const manifest = readJson<Manifest>(
          manifestPath(config.recordingsDir, network, job.fixtureId),
        );
        if (manifest?.complete) {
          job.stage = "complete";
          job.lastError = undefined;
          continue;
        }

        const hasRecording = recordingEvidence(config.recordingsDir, network, job.fixtureId);
        if (plan.stage === "backfill-due" && !hasRecording && !existing) {
          // Do not bulk-download every historical World Cup fixture in snapshot.
          jobs.delete(plan.fixtureId);
          continue;
        }

        if (terminalManifest(manifest)) {
          if (job.stage === "recording" || job.stage === "draining") {
            job.stage = "draining";
            job.terminalSeenAtMs ??= now;
          } else if (job.stage !== "finalizing") {
            job.stage = "awaiting-backfill";
            job.nextBackfillAtMs ??= Math.max(now, job.historicalAtMs);
          }
        } else if (
          now >= job.recordAtMs &&
          now < job.startTimeMs + RECORDING_LATE_WINDOW_MS &&
          job.stage !== "finalizing"
        ) {
          if (job.stage === "armed" || job.stage === "error" || job.stage === "awaiting-backfill") {
            job.stage = "recording";
            job.lastError = undefined;
            log.info(
              `${job.fixtureId} armed window reached: ${job.home}–${job.away}, kickoff ${iso(job.startTimeMs)}`,
            );
          }
        } else if (now < job.recordAtMs && job.stage !== "complete") {
          if (job.stage !== "armed") job.stage = "armed";
        }
        job.updatedAtMs = now;
      }

      for (const job of jobs.values()) {
        if (job.stage === "recording") ensureLiveChildren(job, now);
        if (job.stage === "draining") {
          ensureLiveChildren(job, now);
          if (job.terminalSeenAtMs && now - job.terminalSeenAtMs >= drainMs) {
            await finishLive(job);
          }
        }
        if (
          job.stage === "awaiting-backfill" &&
          now >= job.historicalAtMs &&
          now >= (job.nextBackfillAtMs ?? 0)
        ) {
          await finalizeHistorical(job);
        }
      }
      saveState();
    } catch (error) {
      log.warn(`poll failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      ticking = false;
    }
  };

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received — flushing active captures`);
    await Promise.all(
      [...jobs.values()].flatMap((job) => [stopChild(job.materializer), stopChild(job.recorder)]),
    );
    saveState();
    releaseLock(lockFile);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("exit", () => releaseLock(lockFile));

  log.info(
    `auto-recorder pid=${process.pid} network=${network} competition=${competitionId} ` +
      `poll=${pollMs / 1_000}s lead=${prestartMs / 60_000}m drain=${drainMs / 1_000}s`,
  );
  await tick();
  setInterval(() => void tick(), pollMs);
}

main().catch((error) => {
  log.error("fatal", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
