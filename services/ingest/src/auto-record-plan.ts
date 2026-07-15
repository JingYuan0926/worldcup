/** Pure fixture parsing and scheduling helpers for the long-running recorder. */

export const WORLD_CUP_COMPETITION_ID = 72;
export const DEFAULT_LOOKAHEAD_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_PRESTART_MS = 10 * 60 * 1_000;
export const DEFAULT_HISTORICAL_DELAY_MS = 6 * 60 * 60 * 1_000;
export const DEFAULT_HISTORY_RETENTION_MS = 14 * 24 * 60 * 60 * 1_000;
export const TERMINAL_PHASES = new Set([5, 10, 13, 15, 16, 19]);

type Rec = Record<string, unknown>;

export interface WorldCupFixture {
  fixtureId: number;
  startTimeMs: number;
  competitionId: number | null;
  competition: string;
  home: string;
  away: string;
}

export type FixturePlanStage = "armed" | "record-due" | "backfill-due" | "complete";

export interface FixturePlan extends WorldCupFixture {
  stage: FixturePlanStage;
  recordAtMs: number;
  historicalAtMs: number;
}

export interface PlanOptions {
  nowMs: number;
  /** How far into the future newly published fixtures are armed. */
  lookaheadMs?: number;
  /** Start raw streams this long before kickoff. */
  prestartMs?: number;
  /** TxLINE historical scores become available this long after kickoff. */
  historicalDelayMs?: number;
  /** Ignore stale fixtures outside TxLINE's historical retention window. */
  historyRetentionMs?: number;
  competitionId?: number;
  completeFixtureIds?: ReadonlySet<number>;
}

function isRec(value: unknown): value is Rec {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pick(record: Rec, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
    const actual = Object.keys(record).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (actual) return record[actual];
  }
  return undefined;
}

/** Accept TxLINE's observed array and common wrapped snapshot response shapes. */
export function fixtureRecords(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRec(payload)) return [];
  for (const key of ["data", "records", "results", "items", "fixtures"]) {
    const value = pick(payload, key);
    if (Array.isArray(value)) return value;
    if (isRec(value)) {
      const nested = fixtureRecords(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestampMs(value: unknown): number | null {
  const numeric = finiteNumber(value);
  if (numeric !== null && numeric > 0) {
    // Be liberal if an environment returns epoch seconds instead of documented ms.
    return numeric < 100_000_000_000 ? numeric * 1_000 : numeric;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function label(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (isRec(value)) {
    const name = pick(value, "Name", "name", "ShortName", "shortName", "Code", "code");
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return fallback;
}

/** Normalize one fixture without retaining unrelated or sensitive response fields. */
export function normalizeWorldCupFixture(
  value: unknown,
  competitionId = WORLD_CUP_COMPETITION_ID,
): WorldCupFixture | null {
  if (!isRec(value)) return null;
  const fixtureId = finiteNumber(pick(value, "FixtureId", "fixtureId"));
  const startTimeMs = timestampMs(pick(value, "StartTime", "startTime", "Kickoff", "kickoff"));
  const fixtureCompetitionId = finiteNumber(pick(value, "CompetitionId", "competitionId"));
  const competition = label(pick(value, "Competition", "competition"), "");
  const isWorldCup =
    fixtureCompetitionId === competitionId || /(?:fifa\s+)?world\s*cup/i.test(competition);
  if (!fixtureId || !Number.isInteger(fixtureId) || !startTimeMs || !isWorldCup) return null;

  return {
    fixtureId,
    startTimeMs,
    competitionId: fixtureCompetitionId,
    competition: competition || `Competition ${competitionId}`,
    home: label(pick(value, "Participant1", "participant1", "Home", "home"), "Home"),
    away: label(pick(value, "Participant2", "participant2", "Away", "away"), "Away"),
  };
}

/**
 * Select every relevant World Cup fixture and calculate its next durable action.
 * There is intentionally no single-fixture assumption: simultaneous fixtures each
 * receive an independent plan.
 */
export function planWorldCupFixtures(payload: unknown, options: PlanOptions): FixturePlan[] {
  const lookaheadMs = options.lookaheadMs ?? DEFAULT_LOOKAHEAD_MS;
  const prestartMs = options.prestartMs ?? DEFAULT_PRESTART_MS;
  const historicalDelayMs = options.historicalDelayMs ?? DEFAULT_HISTORICAL_DELAY_MS;
  const retentionMs = options.historyRetentionMs ?? DEFAULT_HISTORY_RETENTION_MS;
  const competitionId = options.competitionId ?? WORLD_CUP_COMPETITION_ID;
  const complete = options.completeFixtureIds ?? new Set<number>();
  const byId = new Map<number, WorldCupFixture>();

  for (const record of fixtureRecords(payload)) {
    const fixture = normalizeWorldCupFixture(record, competitionId);
    if (!fixture) continue;
    if (fixture.startTimeMs > options.nowMs + lookaheadMs) continue;
    if (fixture.startTimeMs < options.nowMs - retentionMs) continue;
    byId.set(fixture.fixtureId, fixture);
  }

  return [...byId.values()]
    .sort((a, b) => a.startTimeMs - b.startTimeMs || a.fixtureId - b.fixtureId)
    .map((fixture) => {
      const recordAtMs = fixture.startTimeMs - prestartMs;
      const historicalAtMs = fixture.startTimeMs + historicalDelayMs;
      let stage: FixturePlanStage;
      if (complete.has(fixture.fixtureId)) stage = "complete";
      else if (options.nowMs >= historicalAtMs) stage = "backfill-due";
      else if (options.nowMs >= recordAtMs) stage = "record-due";
      else stage = "armed";
      return { ...fixture, stage, recordAtMs, historicalAtMs };
    });
}
