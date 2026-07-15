/** Domain types for the Exact Match web app. Mirrors the program spec (README §6). */

export type PoolKind = "COUNT" | "WHEN";

export type PoolState =
  | "OPEN"
  | "LOCKED"
  | "SETTLEABLE"
  | "SETTLED"
  | "CLAIMED"
  | "REFUNDABLE";

/** Numeric game phases (README §7.4). */
export const PHASE = {
  NS: 1,
  H1: 2,
  HT: 3,
  H2: 4,
  F: 5,
  FET: 10,
  FPE: 13,
} as const;

export interface Fixture {
  fixtureId: number;
  /** kickoff, unix ms. */
  startTime: number;
  participant1: string;
  participant2: string;
  competition: string;
  competitionId: number;
  /** short codes / flags for display. */
  p1Code?: string;
  p2Code?: string;
}

export interface Pool {
  id: string;
  fixtureId: number;
  poolIndex: number;
  kind: PoolKind;
  title: string;
  subtitle?: string;
  /** stat keys settled against (README §7.4). */
  statKeyA: number;
  statKeyB?: number;
  /** "Add" when statKeyB present. */
  op?: "Add";
  /** COUNT slider range (inclusive). */
  sliderMin: number;
  sliderMax: number;
  /** which phase the pool settles at. */
  settlePhase: number;
  /** kickoff = lock, unix ms. */
  lockTs: number;
  state: PoolState;
  /** set once settled. COUNT: the value. WHEN: the bucket index. */
  actual?: number;
  /** emoji marker for WHEN pools on the timeline. */
  marker?: string;
  /** which lane a WHEN pool belongs to (P2 stretch). */
  lane?: "home" | "away" | "match";
}

/** One prediction. `stake` is in USDT (whole units) for the UI; convert to base units for payout. */
export interface Entry {
  wallet: string;
  /** COUNT: raw guess. WHEN: bucket index (NEVER = 20). */
  guess: number;
  stake: number;
  claimed?: boolean;
  /** display handle. */
  handle?: string;
}

/** Exact UI placement; monetary settlement still derives a 5-minute bucket. */
export type WhenPlacement =
  | { kind: "time"; atSecond: number }
  | { kind: "never" };

/** A live event observed from the SSE feed during the watch phase. */
export interface LiveEvent {
  kind: "goal" | "corner" | "yellow" | "red";
  team: "home" | "away";
  minute: number;
  /** derived 5-min bucket index. */
  bucket: number;
  label: string;
}

/** Precision-score leaderboard row (off-chain, display only — README §5.3). */
export interface LeaderRow {
  rank: number;
  handle: string;
  wallet: string;
  precision: number; // 100–1000
  pools: number;
  netUsdt: number;
}

export const USDT_DECIMALS = 6;
export const USDT_UNIT = 10 ** USDT_DECIMALS;

/** WHEN-pool bucket model (README §5.1, §5.3). */
export const BUCKET_MINUTES = 5;
export const REGULATION_BUCKETS = 18; // eighteen 5-minute windows, indices 0–17 (0–90')
export const BEYOND_BUCKET = 18; // stoppage / extra time folded here (v1); index 19 is a deliberate gap
export const NEVER_BUCKET = 20;

export function isValidWhenBucket(bucket: number): boolean {
  return Number.isInteger(bucket) && ((bucket >= 0 && bucket <= BEYOND_BUCKET) || bucket === NEVER_BUCKET);
}
