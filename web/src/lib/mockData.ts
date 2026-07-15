import {
  NEVER_BUCKET,
  PHASE,
  USDT_UNIT,
  type Entry,
  type Fixture,
  type LeaderRow,
  type LiveEvent,
  type Pool,
} from "./types";
import { RECORDED_FIXTURES } from "./fixtures";

/**
 * Deterministic demo dataset. The real app hydrates pools/entries from the
 * program + ingest websocket; this drives the UI, the payout previews, and the
 * judges' replay room without a live backend. All randomness is seeded so SSR
 * and client render identically (no hydration mismatch).
 */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HANDLES = [
  "pitchpoet", "xgqueen", "cornerkid", "napoleon", "atlasfox", "var_check",
  "tikitaka", "lehero", "medina", "gk_glove", "offsidetrap", "parkthebus",
  "golazo", "nutmeg99", "stoppage", "hattrick", "cleats", "keeper12",
  "wingback", "falseNine", "libero", "catenaccio", "pressing", "rabona",
];

function wallet(rng: () => number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
  let s = "";
  for (let i = 0; i < 44; i++) s += chars[Math.floor(rng() * chars.length)];
  return s;
}

/** Build a crowd of entries around a weighted value distribution. */
function makeCrowd(
  seed: number,
  weights: Record<number, number>,
  count: number,
  stakeRange: [number, number],
): Entry[] {
  const rng = mulberry32(seed);
  const values = Object.keys(weights).map(Number);
  const total = values.reduce((s, v) => s + (weights[v] ?? 0), 0);
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    let r = rng() * total;
    let guess = values[0] ?? 0;
    for (const v of values) {
      r -= weights[v] ?? 0;
      if (r <= 0) {
        guess = v;
        break;
      }
    }
    const [lo, hi] = stakeRange;
    const stake = Math.round((lo + rng() * (hi - lo)) * 2) / 2; // .5 steps
    out.push({
      wallet: wallet(rng),
      guess,
      stake,
      handle: HANDLES[Math.floor(rng() * HANDLES.length)] ?? `anon${i}`,
    });
  }
  return out;
}

/** Legacy featured fixture used by the self-driving demo and forecast pages. */
export const FIXTURE: Fixture = RECORDED_FIXTURES[0]!;

/** Build the same independent pool set for any captured fixture. */
export function poolsForFixture(fixture: Fixture): Pool[] {
  const lockTs = fixture.startTime;
  return [
  {
    id: "goals-total",
    fixtureId: fixture.fixtureId,
    poolIndex: 0,
    kind: "COUNT",
    title: "Total match goals",
    subtitle: `${fixture.participant1} + ${fixture.participant2}, full time`,
    statKeyA: 1,
    statKeyB: 2,
    op: "Add",
    sliderMin: 0,
    sliderMax: 10,
    settlePhase: PHASE.F,
    lockTs,
    state: "OPEN",
    lane: "match",
  },
  {
    id: "corners-total",
    fixtureId: fixture.fixtureId,
    poolIndex: 1,
    kind: "COUNT",
    title: "Total match corners",
    subtitle: `${fixture.participant1} + ${fixture.participant2}, full time`,
    statKeyA: 7,
    statKeyB: 8,
    op: "Add",
    sliderMin: 0,
    sliderMax: 25,
    settlePhase: PHASE.F,
    lockTs,
    state: "OPEN",
    lane: "match",
  },
  {
    id: "fh-goals",
    fixtureId: fixture.fixtureId,
    poolIndex: 2,
    kind: "COUNT",
    title: "First-half goals",
    subtitle: "Settles at halftime — the flash pool",
    statKeyA: 1001,
    statKeyB: 1002,
    op: "Add",
    sliderMin: 0,
    sliderMax: 6,
    settlePhase: PHASE.HT,
    lockTs,
    state: "OPEN",
    lane: "match",
  },
  {
    id: "when-1st-goal",
    fixtureId: fixture.fixtureId,
    poolIndex: 3,
    kind: "WHEN",
    title: "Window of the 1st goal",
    subtitle: "5-minute settlement buckets",
    statKeyA: 1,
    statKeyB: 2,
    op: "Add",
    sliderMin: 0,
    sliderMax: NEVER_BUCKET,
    settlePhase: PHASE.F,
    lockTs,
    state: "OPEN",
    marker: "⚽",
    lane: "match",
  },
  {
    id: "when-1st-corner",
    fixtureId: fixture.fixtureId,
    poolIndex: 5,
    kind: "WHEN",
    title: "Window of the 1st corner",
    subtitle: "5-minute settlement buckets",
    statKeyA: 7,
    statKeyB: 8,
    op: "Add",
    sliderMin: 0,
    sliderMax: NEVER_BUCKET,
    settlePhase: PHASE.F,
    lockTs,
    state: "OPEN",
    marker: "🚩",
    lane: "match",
  },
  {
    id: "when-1st-yellow",
    fixtureId: fixture.fixtureId,
    poolIndex: 4,
    kind: "WHEN",
    title: "Window of the 1st yellow card",
    subtitle: "5-minute settlement buckets",
    statKeyA: 3,
    statKeyB: 4,
    op: "Add",
    sliderMin: 0,
    sliderMax: NEVER_BUCKET,
    settlePhase: PHASE.F,
    lockTs,
    state: "OPEN",
    marker: "🟨",
    lane: "match",
  },
  {
    id: "when-1st-red",
    fixtureId: fixture.fixtureId,
    poolIndex: 6,
    kind: "WHEN",
    title: "Window of the 1st red card",
    subtitle: "Rare — NEVER is the smart default",
    statKeyA: 5,
    statKeyB: 6,
    op: "Add",
    sliderMin: 0,
    sliderMax: NEVER_BUCKET,
    settlePhase: PHASE.F,
    lockTs,
    state: "OPEN",
    marker: "🟥",
    lane: "match",
  },
  ];
}

export const POOLS: Pool[] = poolsForFixture(FIXTURE);

/** Crowd entries keyed by pool id. */
export const CROWD: Record<string, Entry[]> = {
  "goals-total": makeCrowd(101, { 0: 3, 1: 9, 2: 20, 3: 22, 4: 12, 5: 6, 6: 2 }, 58, [1, 40]),
  "corners-total": makeCrowd(
    202,
    { 6: 2, 7: 5, 8: 9, 9: 16, 10: 21, 11: 17, 12: 11, 13: 6, 14: 3 },
    64,
    [1, 30],
  ),
  "fh-goals": makeCrowd(303, { 0: 24, 1: 26, 2: 12, 3: 4 }, 52, [1, 25]),
  "when-1st-goal": makeCrowd(
    404,
    { 3: 4, 4: 6, 5: 10, 6: 9, 7: 7, 8: 5, 9: 4, 12: 3, 15: 2, [NEVER_BUCKET]: 3 },
    49,
    [1, 20],
  ),
  "when-1st-corner": makeCrowd(
    606,
    { 0: 6, 1: 12, 2: 14, 3: 11, 4: 8, 5: 5, 6: 3, 8: 2, [NEVER_BUCKET]: 1 },
    54,
    [1, 18],
  ),
  "when-1st-yellow": makeCrowd(
    505,
    { 2: 3, 4: 5, 6: 8, 8: 9, 10: 8, 12: 6, 14: 4, 16: 3, [NEVER_BUCKET]: 2 },
    41,
    [1, 15],
  ),
  "when-1st-red": makeCrowd(
    707,
    { 10: 2, 13: 2, 15: 3, 16: 4, 17: 3, 18: 3, [NEVER_BUCKET]: 28 },
    38,
    [1, 12],
  ),
};

/** The match story that the watch phase / replayer animates (France 1–1 Morocco). */
export const LIVE_EVENTS: LiveEvent[] = [
  { kind: "corner", team: "away", minute: 12, bucket: 2, label: "Morocco corner 12'" },
  { kind: "goal", team: "home", minute: 23, bucket: 4, label: "France goal — Mbappé 23'" },
  { kind: "yellow", team: "away", minute: 41, bucket: 8, label: "Morocco yellow — Amrabat 41'" },
  { kind: "goal", team: "away", minute: 67, bucket: 13, label: "Morocco goal — En-Nesyri 67'" },
];

/** Actual settled values for the demo (France 1–1 Morocco, 9 corners). */
export const ACTUALS: Record<string, number> = {
  "goals-total": 2,
  "corners-total": 9,
  "fh-goals": 1,
  "when-1st-goal": 4, // 20–25' bucket
  "when-1st-corner": 2, // 10–15' bucket
  "when-1st-yellow": 8, // 40–45' bucket
  "when-1st-red": NEVER_BUCKET, // no red card — NEVER wins
};

/** A mock TxLINE Merkle proof payload for the settlement-receipt proof viewer. */
export const MOCK_PROOF = {
  fixtureId: FIXTURE.fixtureId,
  seq: 1487,
  statKey: 1001,
  statKey2: 1002,
  predicate: { threshold: 1, comparison: "EqualTo" },
  ts: 1783018800000,
  rootPda: "8LKJAbviArV1XRd5FdELmDwWdJtSuFdj2KDB97LQMUTj",
  settleTx: "5Wf1exampleSettleSigMockToBeReplacedWithRealDevnetTxSignature1234abcd",
  eventStatsSubTreeRoot: "b6f3a1c0d4e2f5a897b1c2d3e4f50617a8b9c0d1e2f3a4b5c6d7e8f90a1b2c3d4",
  fixtureProof: [
    { hash: "9a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00", isRight: true },
    { hash: "00ffeeddccbbaa998877665544332211f09e8d7c6b5a4938271605f4e3d2c1b0a", isRight: false },
  ],
  statProof: [
    { hash: "1122334455667788990011223344556677889900aabbccddeeff001122334455", isRight: false },
    { hash: "aabbccddeeff00112233445566778899aabbccddeeff0011223344556677889a", isRight: true },
  ],
};

export const LEADERBOARD: LeaderRow[] = (() => {
  const rng = mulberry32(9090);
  return Array.from({ length: 12 }, (_, i) => {
    const precision = Math.round(980 - i * (30 + rng() * 20));
    return {
      rank: i + 1,
      handle: HANDLES[i] ?? `anon${i}`,
      wallet: wallet(rng),
      precision,
      pools: 4 + Math.floor(rng() * 20),
      netUsdt: Math.round((1 - i / 8) * 120 * (0.5 + rng())),
    };
  });
})();

/** Base units helper for callers that talk to the program. */
export function toBaseUnits(usdt: number): bigint {
  return BigInt(Math.round(usdt * USDT_UNIT));
}
