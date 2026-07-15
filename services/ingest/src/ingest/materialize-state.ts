/** A replay state assembled cumulatively from TxLINE's sparse action frames. */
export type ReplayRecord = Record<string, unknown>;

export interface ReplayClock {
  seconds: number;
  running: boolean;
}

export interface CumulativeReplayState extends ReplayRecord {
  seq: number;
  sourceTsMs: number;
  phase: number;
  gameState: unknown;
  clock: ReplayClock;
  stats: ReplayRecord;
  home: { goals: number; yellows: number; reds: number; corners: number };
  away: { goals: number; yellows: number; reds: number; corners: number };
}

export interface ReplayStateFrame {
  seq: number;
  ts: number;
  payload: ReplayRecord;
}

function pick(obj: ReplayRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
    const found = Object.keys(obj).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (found && obj[found] !== undefined) return obj[found];
  }
  return undefined;
}

function numberOf(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function booleanOf(value: unknown): boolean {
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
}

function mergeClock(previous: ReplayClock | undefined, payload: ReplayRecord): ReplayClock {
  const fallback = previous ?? { seconds: 0, running: false };
  const raw = pick(payload, "Clock", "clock");
  if (raw === undefined) return fallback;

  if (typeof raw === "string") {
    const [minutes, seconds] = raw.split(":").map(Number);
    return {
      seconds: (minutes || 0) * 60 + (seconds || 0),
      running: true,
    };
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const patch = raw as ReplayRecord;
    const seconds = pick(patch, "Seconds", "seconds");
    const running = pick(patch, "Running", "running");
    return {
      seconds: seconds === undefined ? fallback.seconds : numberOf(seconds),
      running: running === undefined ? fallback.running : booleanOf(running),
    };
  }

  // An explicit null/non-clock value is an explicit reset, not a missing field.
  return { seconds: 0, running: false };
}

function mergeStats(previous: ReplayRecord | undefined, payload: ReplayRecord): ReplayRecord {
  const raw = pick(payload, "Stats", "stats");
  if (raw === undefined) return previous ?? {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  // Stats can itself be sparse, so preserve keys that are not present in this frame.
  return { ...(previous ?? {}), ...(raw as ReplayRecord) };
}

/**
 * Apply one TxLINE frame to the prior replay state.
 *
 * Scores SSE messages are action patches, not guaranteed full snapshots. Only
 * fields explicitly present on the new frame replace prior values; nested Clock
 * and Stats fields follow the same rule. Explicit zeroes and corrections remain
 * authoritative.
 */
export function foldReplayState(
  previous: CumulativeReplayState | null,
  frame: ReplayStateFrame,
): CumulativeReplayState {
  const phaseValue = pick(frame.payload, "StatusId", "statusSoccerId", "phase");
  const gameStateValue = pick(frame.payload, "GameState", "gameState");
  const stats = mergeStats(previous?.stats, frame.payload);
  const value = (key: number) => numberOf(stats[String(key)]);

  return {
    seq: frame.seq,
    sourceTsMs: frame.ts,
    phase: phaseValue === undefined ? (previous?.phase ?? 0) : numberOf(phaseValue),
    gameState: gameStateValue === undefined ? (previous?.gameState ?? null) : gameStateValue,
    clock: mergeClock(previous?.clock, frame.payload),
    stats,
    home: { goals: value(1), yellows: value(3), reds: value(5), corners: value(7) },
    away: { goals: value(2), yellows: value(4), reds: value(6), corners: value(8) },
  };
}
