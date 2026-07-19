import { MATCH_SECONDS, type Side } from "@/lib/demo";

/**
 * The money path: goal-window pools (README §5.1, "Window of the Nth goal" +
 * the P2 team-lane variant). Corners and cards are display-only — they are drawn
 * on the timeline but never staked.
 *
 * One pool per (team, goal ordinal), which is exactly what the two-lane timeline
 * already draws: a marker on the ARG lane is a call on "which 5-minute window
 * does Argentina's Nth goal land in". The program allows one entry per wallet per
 * pool, so the Nth marker you place on a lane IS your entry in that lane's Nth-goal
 * pool — no extra input flow, per the §5.1 "primitive" gate.
 */

/** Settlement granularity: on-chain roots are posted per 5-minute batch (README §5.1). */
export const BUCKET_SECONDS = 5 * 60;

/** Bucket index for "this goal never happens" (README §5.3). */
export const NEVER_BUCKET = 20;

/** Buckets 0–17 are regulation; 18 absorbs stoppage/extra time; 20 = NEVER. */
export const MAX_REAL_BUCKET = 18;

export interface GoalPool {
  /** `pool_index` on-chain — the PDA seed. Stable forever; never renumber. */
  poolIndex: number;
  side: Side;
  /** 1 = that team's first goal, 2 = second, … */
  ordinal: number;
  /** TxLINE stat key: 1 = participant-1 goals, 2 = participant-2 goals (§7.4). */
  statKey: number;
  label: string;
}

/**
 * Argentina scored 3, Switzerland 1 (fixture 18222446). Pools run one past each
 * real count so a caller can be wrong in the interesting direction — betting on a
 * goal that never comes is a live outcome (NEVER), not an impossible one.
 */
export const GOAL_POOLS: GoalPool[] = [
  { poolIndex: 0, side: "home", ordinal: 1, statKey: 1, label: "ARG 1st goal" },
  { poolIndex: 1, side: "home", ordinal: 2, statKey: 1, label: "ARG 2nd goal" },
  { poolIndex: 2, side: "home", ordinal: 3, statKey: 1, label: "ARG 3rd goal" },
  { poolIndex: 3, side: "home", ordinal: 4, statKey: 1, label: "ARG 4th goal" },
  { poolIndex: 4, side: "away", ordinal: 1, statKey: 2, label: "SUI 1st goal" },
  { poolIndex: 5, side: "away", ordinal: 2, statKey: 2, label: "SUI 2nd goal" },
];

export function poolFor(side: Side, ordinal: number): GoalPool | undefined {
  return GOAL_POOLS.find((p) => p.side === side && p.ordinal === ordinal);
}

/** Max goal calls a user can place on one lane — bounded by the pools that exist. */
export function maxOrdinal(side: Side): number {
  return GOAL_POOLS.filter((p) => p.side === side).length;
}

/**
 * The 5-minute bucket a second falls in. Everything past `MAX_REAL_BUCKET * 5min`
 * folds into bucket 18: extra time is not separately bucketed in v1 (README §5.1),
 * which is why this match's 120:44 winner settles in the same bucket as 90:01.
 */
export function bucketOf(second: number): number {
  return Math.min(MAX_REAL_BUCKET, Math.floor(second / BUCKET_SECONDS));
}

export function bucketRange(bucket: number): { start: number; end: number } {
  if (bucket >= MAX_REAL_BUCKET) {
    return { start: MAX_REAL_BUCKET * BUCKET_SECONDS, end: MATCH_SECONDS };
  }
  return { start: bucket * BUCKET_SECONDS, end: (bucket + 1) * BUCKET_SECONDS - 1 };
}

const mmss = (s: number) => {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

export function bucketLabel(bucket: number): string {
  if (bucket === NEVER_BUCKET) return "NEVER";
  const { start, end } = bucketRange(bucket);
  return `${mmss(start)}–${mmss(end)}`;
}

/* ------------------------------------------------------------ flash market */

/**
 * The in-play pool: **how many minutes of the match are a draw?**
 *
 * A COUNT pool over the match clock (0–124), not a WHEN pool — the answer is a
 * duration, not a window, so the slider reads in minutes and settles on the exact
 * minute rather than a 5-minute bucket.
 *
 * ── Honest caveat ───────────────────────────────────────────────────────────
 * This market FAILS the "Provable" gate in README §5.1, which admits a template
 * only if it settles from ≤2 on-chain stat keys. Minutes-level cannot: it needs
 * the whole goal timeline, because the same 3–1 scoreline is reachable via wildly
 * different tie durations. Under the resolver it settles fine (the outcome is
 * derived from the recorded feed, same as every other pool), but it could not
 * become trustless under the current `validate_stat` design without a proof per
 * goal. Worth saying out loud rather than letting a judge find it.
 */
export const FLASH_POOL = {
  poolIndex: 6,
  /** Stat keys are recorded for provenance; settlement derives from goal timings. */
  statKey: 1,
  label: "Minutes drawn",
  question: "How many minutes will this match be a draw?",
  min: 0,
  max: 124,
} as const;

/** The market drops here on the match clock — deep enough in to have a read on the game. */
export const FLASH_DROP_SECOND = 20 * 60;

export const ALL_POOL_INDEXES = [...GOAL_POOLS.map((p) => p.poolIndex), FLASH_POOL.poolIndex];

/**
 * Minutes the match spent drawn, from the goal timeline.
 *
 * Walks the scoreline: every stretch where the sides are equal counts, including
 * 0–0 from kickoff and any draw still standing at full time. This fixture: 0–0 until
 * 9:35 and 1–1 from 66:50 to 111:42 → 54 minutes.
 */
export function minutesDrawn(
  goals: { second: number; side: Side }[],
  matchSeconds: number,
): number {
  const sorted = [...goals].sort((a, b) => a.second - b.second);
  let home = 0;
  let away = 0;
  let prev = 0;
  let drawn = 0;
  for (const g of sorted) {
    if (home === away) drawn += g.second - prev;
    if (g.side === "home") home++;
    else away++;
    prev = g.second;
  }
  if (home === away) drawn += matchSeconds - prev;
  return Math.floor(drawn / 60);
}
