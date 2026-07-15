/**
 * Stat ticker — pure functions that turn one raw TxLINE Scores JSON frame into a
 * normalized {@link MatchState}, and diff two states into discrete
 * {@link LiveEvent}s (goal / corner / yellow / red, per team, snapped to a
 * 5-minute settlement bucket).
 *
 * These are the ONLY place the raw wire shape is decoded — the fan-out, the
 * websocket clients, and the UI all consume the normalized types below. Keep it
 * pure (no I/O, no clock reads) so it can be unit-tested against recorded frames.
 *
 * Snapshot wire shape (README §7.3 / §7.4, used by the bundled sample):
 *   { fixtureId, seq, ts, statusSoccerId,
 *     scoreSoccer.Participant1|Participant2.Total.{Goals,YellowCards,RedCards,Corners},
 *     stats: { "1":P1goals, "2":P2goals, "3":P1yellows, "4":P2yellows,
 *              "5":P1reds,  "6":P2reds,  "7":P1corners, "8":P2corners },
 *     dataSoccer.{Clock:"MM:SS", Minutes} }
 *
 * The live devnet SSE feed was confirmed on 2026-07-09 to use PascalCase action
 * records instead: `{ FixtureId, Seq, Ts, StatusId, Clock:{Seconds}, Stats }`.
 * Every record still carries the complete cumulative Stats map, so the same
 * snapshot/diff model works for recording and replay. Accessors below accept
 * both shapes and are case-insensitive.
 */

// ── normalized types (the fan-out + UI contract) ────────────────────────────

/** Per-team running counters, home = Participant1, away = Participant2. */
export interface TeamStats {
  goals: number;
  corners: number;
  yellows: number;
  reds: number;
}

/** Normalized snapshot of a match at one `seq`. */
export interface MatchState {
  fixtureId: number;
  /** Per-fixture sequence — the settlement cursor (README §7.3). */
  seq: number;
  /** Frame timestamp in unix ms. */
  ts: number;
  /** `statusSoccerId` game phase (README §7.4: NS 1, H1 2, HT 3, H2 4, F 5, …). */
  phase: number;
  /** Elapsed match minute derived from `dataSoccer` (display only; money settles buckets). */
  clockMinute: number;
  home: TeamStats;
  away: TeamStats;
}

export type EventKind = "goal" | "corner" | "yellow" | "red";
export type TeamSide = "home" | "away";

/**
 * A discrete scoring event derived by diffing two {@link MatchState}s. One event
 * is emitted per unit increase of a counter, so a stat that jumps by 2 within a
 * single 5-min batch yields two events (both in the same bucket — the honest
 * limit of batched data; README §5.1).
 */
export interface LiveEvent {
  fixtureId: number;
  /** `seq` of the frame that first reported the increase. */
  seq: number;
  ts: number;
  kind: EventKind;
  side: TeamSide;
  /** Match minute of the reporting frame (display only). */
  clockMinute: number;
  /** 5-minute settlement bucket index (0–17 regulation, 18 = stoppage/beyond). */
  bucket: number;
  /** Running count of this stat FOR THIS TEAM after the event (the Nth team event). */
  count: number;
  /** Running count of this stat ACROSS BOTH TEAMS after the event (the Nth match event). */
  total: number;
}

// ── settlement bucket vocabulary (README §5.1 / §5.3) ───────────────────────

/** Minutes per settlement bucket (WHEN pools settle on 5-min batches). */
export const BUCKET_MINUTES = 5;
/** Number of regulation buckets covering 0–90' (indices 0–17). */
export const REGULATION_BUCKETS = 18;
/** Bucket index for stoppage time / anything ≥ 90' (extra time folds in — v1 cut). */
export const STOPPAGE_BUCKET = 18;
/** Sentinel bucket for a "the event never happened" outcome (README §5.3). */
export const NEVER_BUCKET = 20;

/**
 * Map a match minute to its 5-minute settlement bucket. 0–4' → 0, 5–9' → 1, …,
 * 85–89' → 17, and everything ≥ 90' → {@link STOPPAGE_BUCKET}. NEVER is never
 * produced here — it is an outcome decided at settlement, not from a live frame.
 */
export function bucketForMinute(minute: number): number {
  if (!Number.isFinite(minute) || minute <= 0) return 0;
  return Math.min(Math.floor(minute / BUCKET_MINUTES), STOPPAGE_BUCKET);
}

// ── raw-frame access helpers (defensive about casing / numeric strings) ─────

type Rec = Record<string, unknown>;
function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Case-insensitive property read (exact match preferred, then lower-cased). */
function get(obj: unknown, key: string): unknown {
  if (!isRec(obj)) return undefined;
  if (key in obj) return obj[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(obj)) if (k.toLowerCase() === lower) return obj[k];
  return undefined;
}

/** Coerce numbers and numeric strings (the `stats` map keys are strings); else undefined. */
function num(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Read a `stats` map value by numeric key, tolerating "7" (JSON) or 7. */
function statVal(stats: unknown, key: number): number | undefined {
  if (!isRec(stats)) return undefined;
  return num(stats[String(key)] ?? stats[key as unknown as string]);
}

/** stats-map base keys per (kind, side) — README §7.4. */
const STAT_KEYS: Record<EventKind, { home: number; away: number; field: string }> = {
  goal: { home: 1, away: 2, field: "Goals" },
  yellow: { home: 3, away: 4, field: "YellowCards" },
  red: { home: 5, away: 6, field: "RedCards" },
  corner: { home: 7, away: 8, field: "Corners" },
};

/** Stable diff order — keeps event streams deterministic frame-to-frame. */
const KINDS: readonly EventKind[] = ["goal", "yellow", "red", "corner"];
const SIDES: readonly TeamSide[] = ["home", "away"];

/**
 * Read one team's counters, preferring `scoreSoccer.ParticipantN.Total.<Field>`
 * and falling back to the `stats` map so a missing/renamed `scoreSoccer` block
 * still yields real numbers.
 */
function readTeam(participantTotal: unknown, stats: unknown, side: TeamSide): TeamStats {
  const pick = (kind: EventKind): number => {
    const fromScore = num(get(participantTotal, STAT_KEYS[kind].field));
    if (fromScore !== undefined) return fromScore;
    const fromStats = statVal(stats, STAT_KEYS[kind][side]);
    return fromStats ?? 0;
  };
  return { goals: pick("goal"), corners: pick("corner"), yellows: pick("yellow"), reds: pick("red") };
}

/** Derive elapsed match minutes from snapshot or live-action clock shapes. */
function readClockMinute(dataSoccer: unknown): number {
  const minutes = num(get(dataSoccer, "Minutes"));
  if (minutes !== undefined) return Math.max(0, Math.floor(minutes));
  const clock = get(dataSoccer, "Clock");
  if (typeof clock === "string") {
    const mm = num(clock.split(":")[0]);
    if (mm !== undefined) return Math.max(0, Math.floor(mm));
  }
  const seconds = num(get(clock, "Seconds"));
  if (seconds !== undefined) return Math.max(0, Math.floor(seconds / 60));
  return 0;
}

/**
 * Normalize one parsed Scores frame into a {@link MatchState}. Accepts the parsed
 * JSON object (what the SSE `data` string parses to); also tolerates being handed
 * the raw string. Never throws — unknown/absent fields fall back to 0.
 */
export function deriveState(dataJson: unknown): MatchState {
  let root: unknown = dataJson;
  if (typeof dataJson === "string") {
    try {
      root = JSON.parse(dataJson);
    } catch {
      root = {};
    }
  }

  const stats = get(root, "stats");
  const scoreSoccer = get(root, "scoreSoccer");
  const p1 = get(get(scoreSoccer, "Participant1"), "Total");
  const p2 = get(get(scoreSoccer, "Participant2"), "Total");
  // Live action frames put Clock directly on the root; snapshots nest it.
  const dataSoccer = get(root, "dataSoccer") ?? root;

  return {
    fixtureId: num(get(root, "fixtureId")) ?? 0,
    seq: num(get(root, "seq")) ?? 0,
    ts: num(get(root, "ts")) ?? 0,
    phase: num(get(root, "statusSoccerId")) ?? num(get(root, "statusId")) ?? 0,
    clockMinute: readClockMinute(dataSoccer),
    home: readTeam(p1, stats, "home"),
    away: readTeam(p2, stats, "away"),
  };
}

const FIELD: Record<EventKind, keyof TeamStats> = {
  goal: "goals",
  corner: "corners",
  yellow: "yellows",
  red: "reds",
};

/**
 * Diff two normalized states into the discrete events that occurred between them.
 * Emits one {@link LiveEvent} per unit increase of any (kind, side) counter,
 * tagged with the 5-minute bucket of the reporting frame.
 *
 * `prev === null` (first frame / fresh connect) yields no events: with no
 * baseline we can't attribute a count to a moment. A decrease (data correction)
 * yields no events. A fixtureId mismatch yields no events (defensive).
 */
export function diffEvents(prev: MatchState | null, next: MatchState): LiveEvent[] {
  if (!prev) return [];
  if (prev.fixtureId !== 0 && next.fixtureId !== 0 && prev.fixtureId !== next.fixtureId) return [];

  const bucket = bucketForMinute(next.clockMinute);
  const events: LiveEvent[] = [];

  for (const kind of KINDS) {
    const field = FIELD[kind];
    // Combined running total base (for the Nth-of-match index shared across teams).
    const combinedBase = prev.home[field] + prev.away[field];
    let combinedIdx = 0;
    for (const side of SIDES) {
      const before = prev[side][field];
      const after = next[side][field];
      for (let count = before + 1; count <= after; count++) {
        combinedIdx++;
        events.push({
          fixtureId: next.fixtureId,
          seq: next.seq,
          ts: next.ts,
          kind,
          side,
          clockMinute: next.clockMinute,
          bucket,
          count,
          total: combinedBase + combinedIdx,
        });
      }
    }
  }

  return events;
}
