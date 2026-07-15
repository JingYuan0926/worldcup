import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Network = "devnet" | "mainnet";
type Team = "home" | "away";
type EventKind = "goal" | "corner" | "yellow" | "red";
type RecordValue = Record<string, unknown>;

interface TimelineUpdate {
  seq?: unknown;
  tsMs?: unknown;
  payload?: unknown;
}

interface TimelineRow {
  fixtureId?: unknown;
  second?: unknown;
  fromTsMs?: unknown;
  toTsMsExclusive?: unknown;
  fill?: unknown;
  state?: unknown;
  updates?: unknown;
}

interface LiveEvent {
  id: string;
  seq: number;
  kind: EventKind;
  team: Team;
  participant: 1 | 2;
  matchClockSeconds: number;
  tsMs: number;
  confirmed: true;
}

interface ParsedRecording {
  fixtureId: number;
  network: Network;
  timelineUpdatedAtMs: number;
  recordingSecond: number;
  recordedThroughTsMs: number;
  fill: string;
  phase: number | null;
  phaseLabel: string;
  clock: {
    seconds: number | null;
    maxSeconds: number | null;
    running: boolean;
    observedAtTsMs: number | null;
  };
  stats: {
    home: TeamStats;
    away: TeamStats;
  };
  events: LiveEvent[];
  coverage: {
    firstObservedSecond: number | null;
    firstObservedMatchClockSeconds: number | null;
    unknownOpeningSeconds: number;
    complete: boolean;
  };
}

interface TeamStats {
  goals: number;
  corners: number;
  yellows: number;
  reds: number;
}

interface CacheEntry {
  signature: string;
  value: ParsedRecording;
  lastUsedAt: number;
}

const PHASE_LABELS: Readonly<Record<number, string>> = {
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

const TERMINAL_PHASES = new Set([5, 10, 13, 15, 16, 19]);
const MAX_CACHE_ENTRIES = 8;
const cache = new Map<string, CacheEntry>();

const EVENT_STATS: ReadonlyArray<{
  statKey: string;
  kind: EventKind;
  team: Team;
  participant: 1 | 2;
}> = [
  { statKey: "1", kind: "goal", team: "home", participant: 1 },
  { statKey: "2", kind: "goal", team: "away", participant: 2 },
  { statKey: "3", kind: "yellow", team: "home", participant: 1 },
  { statKey: "4", kind: "yellow", team: "away", participant: 2 },
  { statKey: "5", kind: "red", team: "home", participant: 1 },
  { statKey: "6", kind: "red", team: "away", participant: 2 },
  { statKey: "7", kind: "corner", team: "home", participant: 1 },
  { statKey: "8", kind: "corner", team: "away", participant: 2 },
];

function asRecord(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function own(record: RecordValue, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  const insensitive = Object.keys(record).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase(),
  );
  return insensitive === undefined ? undefined : record[insensitive];
}

function recordingRoot(): string {
  const cwd = process.cwd();
  return basename(cwd) === "web" ? resolve(cwd, "..", "recordings") : resolve(cwd, "recordings");
}

function parseClock(payload: RecordValue): { seconds: number; running: boolean } | null {
  const rawClock = asRecord(own(payload, "Clock"));
  if (!rawClock) return null;
  const seconds = finiteNumber(own(rawClock, "Seconds"));
  if (seconds === null || seconds < 0) return null;
  return { seconds: Math.floor(seconds), running: Boolean(own(rawClock, "Running")) };
}

function eventIndex(kind: EventKind, team: Team): number {
  return EVENT_STATS.findIndex((spec) => spec.kind === kind && spec.team === team);
}

function emptyTeamStats(): TeamStats {
  return { goals: 0, corners: 0, yellows: 0, reds: 0 };
}

function projectStats(stats: ReadonlyMap<string, number>): { home: TeamStats; away: TeamStats } {
  const home = emptyTeamStats();
  const away = emptyTeamStats();
  for (const spec of EVENT_STATS) {
    const target = spec.team === "home" ? home : away;
    const value = stats.get(spec.statKey) ?? 0;
    if (spec.kind === "goal") target.goals = value;
    else if (spec.kind === "corner") target.corners = value;
    else if (spec.kind === "yellow") target.yellows = value;
    else target.reds = value;
  }
  return { home, away };
}

function parseTimeline(
  body: string,
  fixtureId: number,
  network: Network,
  timelineUpdatedAtMs: number,
): ParsedRecording {
  const cumulativeStats = new Map<string, number>();
  const eventStacks = EVENT_STATS.map(() => [] as LiveEvent[]);
  let hasCumulativeBaseline = false;
  let latestSecond = 0;
  let recordedThroughTsMs = 0;
  let latestFill = "unknown";
  let phase: number | null = null;
  let clockSeconds: number | null = null;
  let maxClockSeconds: number | null = null;
  let clockRunning = false;
  let clockObservedAtTsMs: number | null = null;
  let firstObservedSecond: number | null = null;
  let firstObservedMatchClockSeconds: number | null = null;

  const lines = body.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!.trim();
    if (!line) continue;

    let row: TimelineRow;
    try {
      row = JSON.parse(line) as TimelineRow;
    } catch {
      throw new Error(`invalid timeline row ${lineIndex + 1}`);
    }

    const rowFixtureId = finiteNumber(row.fixtureId);
    if (rowFixtureId !== fixtureId) throw new Error("timeline fixture mismatch");

    const rowSecond = finiteNumber(row.second);
    if (rowSecond !== null && rowSecond >= latestSecond) {
      latestSecond = Math.floor(rowSecond);
      latestFill = typeof row.fill === "string" ? row.fill : latestFill;
      const rowThrough = finiteNumber(row.toTsMsExclusive);
      if (rowThrough !== null) recordedThroughTsMs = Math.max(0, rowThrough - 1);
    }

    const updates = Array.isArray(row.updates) ? (row.updates as TimelineUpdate[]) : [];
    const observed = row.state !== null && row.state !== undefined;
    if (firstObservedSecond === null && (observed || updates.length > 0) && rowSecond !== null) {
      firstObservedSecond = Math.floor(rowSecond);
    }

    for (const update of updates) {
      const payload = asRecord(update.payload);
      if (!payload) continue;
      const seq = finiteNumber(update.seq ?? own(payload, "Seq"));
      const tsMs = finiteNumber(update.tsMs ?? own(payload, "Ts"));
      if (seq === null || tsMs === null) continue;

      // Sparse actions sometimes omit StatusId or Clock. Only replace a field
      // when that field is truly present, otherwise preserve the last value.
      const nextPhase = finiteNumber(own(payload, "StatusId"));
      if (nextPhase !== null && nextPhase > 0) phase = Math.floor(nextPhase);

      const nextClock = parseClock(payload);
      if (nextClock) {
        clockSeconds = nextClock.seconds;
        maxClockSeconds = Math.max(maxClockSeconds ?? 0, nextClock.seconds);
        clockRunning = nextClock.running;
        clockObservedAtTsMs = tsMs;
        if (firstObservedMatchClockSeconds === null) {
          firstObservedMatchClockSeconds = nextClock.seconds;
        }
      }

      const nextStats = asRecord(own(payload, "Stats"));
      if (!nextStats) continue;

      // Stats are cumulative. The first observed snapshot is a baseline only:
      // it may already contain events from before this recorder started.
      if (!hasCumulativeBaseline) {
        for (const [key, rawValue] of Object.entries(nextStats)) {
          const value = finiteNumber(rawValue);
          if (value !== null) cumulativeStats.set(key, Math.max(0, Math.floor(value)));
        }
        hasCumulativeBaseline = true;
        continue;
      }

      for (const spec of EVENT_STATS) {
        if (!Object.prototype.hasOwnProperty.call(nextStats, spec.statKey)) continue;
        const nextValue = finiteNumber(nextStats[spec.statKey]);
        if (nextValue === null) continue;
        const normalizedNext = Math.max(0, Math.floor(nextValue));
        const previous = cumulativeStats.get(spec.statKey);
        cumulativeStats.set(spec.statKey, normalizedNext);
        if (previous === undefined || normalizedNext === previous) continue;

        const stack = eventStacks[eventIndex(spec.kind, spec.team)]!;
        if (normalizedNext < previous) {
          // A correction/VAR can decrement a cumulative stat. Remove only pins
          // that were derived during captured coverage; unknown opening events
          // were never emitted and therefore cannot be falsely timestamped.
          for (let removed = 0; removed < previous - normalizedNext && stack.length; removed++) {
            stack.pop();
          }
          continue;
        }

        // Canonical TxLINE confirmations increment a cumulative stat by one.
        // If a gap produces a larger jump, only one occurrence is locatable at
        // this update; the remaining count stays visible in totals, without
        // inventing duplicate timestamps.
        if (!nextClock) continue;
        stack.push({
          id: `${fixtureId}:${Math.floor(seq)}:${spec.kind}:${spec.team}`,
          seq: Math.floor(seq),
          kind: spec.kind,
          team: spec.team,
          participant: spec.participant,
          matchClockSeconds: nextClock.seconds,
          tsMs: Math.floor(tsMs),
          confirmed: true,
        });
      }

      // Carry every numeric stat forward, including period-specific keys. The
      // public response projects only the eight full-match values above.
      for (const [key, rawValue] of Object.entries(nextStats)) {
        const value = finiteNumber(rawValue);
        if (value !== null) cumulativeStats.set(key, Math.max(0, Math.floor(value)));
      }
    }
  }

  if (latestSecond < 1) throw new Error("timeline has no rows");
  const events = eventStacks
    .flat()
    .sort((a, b) => a.matchClockSeconds - b.matchClockSeconds || a.seq - b.seq);
  const stats = projectStats(cumulativeStats);
  const unknownOpeningSeconds = firstObservedSecond === null ? latestSecond : firstObservedSecond - 1;
  const complete = unknownOpeningSeconds === 0 && phase !== null && TERMINAL_PHASES.has(phase);

  return {
    fixtureId,
    network,
    timelineUpdatedAtMs,
    recordingSecond: latestSecond,
    recordedThroughTsMs,
    fill: latestFill,
    phase,
    phaseLabel: phase === null ? "UNKNOWN" : (PHASE_LABELS[phase] ?? `#${phase}`),
    clock: {
      seconds: clockSeconds,
      maxSeconds: maxClockSeconds,
      running: clockRunning,
      observedAtTsMs: clockObservedAtTsMs,
    },
    stats,
    events,
    coverage: {
      firstObservedSecond,
      firstObservedMatchClockSeconds,
      unknownOpeningSeconds,
      complete,
    },
  };
}

function evictOldCacheEntries(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const oldest = [...cache.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0];
  if (oldest) cache.delete(oldest[0]);
}

async function loadRecording(fixtureId: number, network: Network): Promise<ParsedRecording | null> {
  const file = resolve(recordingRoot(), network, String(fixtureId), "timeline-1s.ndjson");
  let fileStat;
  try {
    fileStat = await stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!fileStat.isFile()) return null;

  const cacheKey = `${network}:${fixtureId}`;
  const signature = `${fileStat.ino}:${fileStat.size}:${fileStat.mtimeMs}`;
  const cached = cache.get(cacheKey);
  if (cached?.signature === signature) {
    cached.lastUsedAt = Date.now();
    return cached.value;
  }

  const body = await readFile(file, "utf8");
  const value = parseTimeline(body, fixtureId, network, fileStat.mtimeMs);
  cache.set(cacheKey, { signature, value, lastUsedAt: Date.now() });
  evictOldCacheEntries();
  return value;
}

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: { fixtureId: string } },
): Promise<NextResponse> {
  if (!/^[1-9]\d{0,15}$/.test(params.fixtureId)) {
    return json({ error: "invalid fixtureId" }, 400);
  }
  const fixtureId = Number(params.fixtureId);
  if (!Number.isSafeInteger(fixtureId)) return json({ error: "invalid fixtureId" }, 400);

  const requestedNetwork = new URL(request.url).searchParams.get("network") ?? "devnet";
  if (requestedNetwork !== "devnet" && requestedNetwork !== "mainnet") {
    return json({ error: "network must be devnet or mainnet" }, 400);
  }

  try {
    const recording = await loadRecording(fixtureId, requestedNetwork);
    if (!recording) return json({ error: "recording not found" }, 404);
    const now = Date.now();
    const clockAgeMs = recording.clock.observedAtTsMs === null
      ? null
      : Math.max(0, now - recording.clock.observedAtTsMs);
    return json({
      ...recording,
      generatedAt: new Date(now).toISOString(),
      asOfTsMs: now,
      score: {
        home: recording.stats.home.goals,
        away: recording.stats.away.goals,
      },
      clock: {
        ...recording.clock,
        ageMs: clockAgeMs,
      },
    });
  } catch (error) {
    console.error("Unable to read live match recording", error);
    return json({ error: "recording is temporarily unavailable" }, 503);
  }
}
