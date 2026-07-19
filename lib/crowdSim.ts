import type { EventKind } from "@/components/Icons";
import { MATCH_SECONDS, type Side } from "@/lib/demo";

/**
 * Deterministic, synthetic per-second crowd — ported from the original frontend's
 * sparse exact-second model (web/src/lib/simulatedCrowd.ts).
 *
 * `count[n]` = number of simulated picks at exactly match second `n`. Most seconds
 * are empty; interest clusters around a few centres and drifts up as the match wears
 * on. `stake[n]` is the USDC (base units) staked at that second. Presentation-only
 * demo data — NOT TxLINE data, real entries, or a settlement input.
 *
 * Rendered per-second on a canvas so 7,441 possible timestamps per lane cost nothing.
 */

const SECONDS = MATCH_SECONDS; // 124 * 60
const SECOND_COUNT = SECONDS + 1;

export interface SecondCrowd {
  /** Picks at each match second, index 0..SECONDS. Sparse. */
  count: number[];
  /** USDC staked (base units) at each match second, aligned to count. */
  stake: number[];
}

type Kind = "goal" | "corner" | "yellow" | "red";

interface Center {
  second: number;
  spread: number;
  weight: number;
}
interface Profile {
  density: number;
  countScale: number;
  centers: Center[];
  peakSecond: number;
  peakCount: number;
}

const PROFILES: Record<Kind, Record<Side, Profile>> = {
  goal: {
    home: {
      density: 0.044,
      countScale: 8,
      centers: [
        { second: 1_420, spread: 560, weight: 1.3 },
        { second: 3_980, spread: 720, weight: 1.05 },
        { second: 5_620, spread: 500, weight: 0.72 },
      ],
      peakSecond: 1_627,
      peakCount: 15,
    },
    away: {
      density: 0.039,
      countScale: 7,
      centers: [
        { second: 1_850, spread: 650, weight: 0.78 },
        { second: 4_060, spread: 640, weight: 1.35 },
        { second: 5_510, spread: 560, weight: 0.86 },
      ],
      peakSecond: 4_012,
      peakCount: 14,
    },
  },
  corner: {
    home: {
      density: 0.052,
      countScale: 7,
      centers: [
        { second: 780, spread: 430, weight: 1.18 },
        { second: 3_180, spread: 780, weight: 0.9 },
        { second: 5_050, spread: 680, weight: 1.08 },
      ],
      peakSecond: 745,
      peakCount: 13,
    },
    away: {
      density: 0.049,
      countScale: 7,
      centers: [
        { second: 1_530, spread: 620, weight: 0.83 },
        { second: 3_070, spread: 650, weight: 1.28 },
        { second: 5_880, spread: 530, weight: 0.94 },
      ],
      peakSecond: 3_064,
      peakCount: 12,
    },
  },
  yellow: {
    home: {
      density: 0.032,
      countScale: 7,
      centers: [
        { second: 2_620, spread: 700, weight: 1.3 },
        { second: 4_760, spread: 720, weight: 1.02 },
        { second: 6_280, spread: 420, weight: 0.8 },
      ],
      peakSecond: 2_729,
      peakCount: 12,
    },
    away: {
      density: 0.036,
      countScale: 8,
      centers: [
        { second: 2_180, spread: 720, weight: 0.86 },
        { second: 4_470, spread: 690, weight: 1.4 },
        { second: 5_980, spread: 500, weight: 1.0 },
      ],
      peakSecond: 4_486,
      peakCount: 15,
    },
  },
  red: {
    home: {
      density: 0.009,
      countScale: 5,
      centers: [
        { second: 3_720, spread: 850, weight: 0.65 },
        { second: 5_180, spread: 620, weight: 1.38 },
      ],
      peakSecond: 5_120,
      peakCount: 9,
    },
    away: {
      density: 0.011,
      countScale: 5,
      centers: [
        { second: 3_100, spread: 900, weight: 0.68 },
        { second: 5_760, spread: 670, weight: 1.45 },
      ],
      peakSecond: 5_804,
      peakCount: 10,
    },
  },
};

const SEEDS: Record<Kind, Record<Side, number>> = {
  goal: { home: 0x237d_91a3, away: 0x9b13_76e5 },
  corner: { home: 0x45ae_20d1, away: 0xe184_39b7 },
  yellow: { home: 0x70c2_5f43, away: 0x1ad9_842f },
  red: { home: 0xc831_0ea9, away: 0x5f24_b6d3 },
};

/** Stable pseudo-random in [0,1), keyed independently per second. */
function randomAt(seed: number, second: number, salt: number): number {
  let value = (seed ^ Math.imul(second + 1, 0x45d9_f3b) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9_f3b) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9_f3b) >>> 0;
  value = (value ^ (value >>> 16)) >>> 0;
  return value / 0x1_0000_0000;
}

function gaussian(second: number, center: Center): number {
  const d = (second - center.second) / center.spread;
  return center.weight * Math.exp(-0.5 * d * d);
}

function build(kind: Kind, side: Side): SecondCrowd {
  const profile = PROFILES[kind][side];
  const seed = SEEDS[kind][side];
  const count = new Array<number>(SECOND_COUNT).fill(0);
  const stake = new Array<number>(SECOND_COUNT).fill(0);

  for (let second = 0; second <= SECONDS; second += 1) {
    const t = second / SECONDS;
    const lateInterest = 0.28 + t * 0.38;
    const centerInterest = profile.centers.reduce((sum, c) => sum + gaussian(second, c), 0);
    const interest = lateInterest + centerInterest;
    const chance = Math.min(0.22, profile.density * interest);
    if (randomAt(seed, second, 0x6d2b_79f5) >= chance) continue;

    const ceiling = Math.max(2, Math.min(profile.peakCount - 1, Math.round(1 + profile.countScale * interest)));
    // Squaring the draw keeps most populated seconds at one or two picks, with the
    // occasional taller bar instead of a dense artificial-looking wall.
    const draw = randomAt(seed, second, 0xa511_e9b3);
    const picks = 1 + Math.floor(draw * draw * ceiling);
    count[second] = picks;
    const usd = 8 + Math.floor(randomAt(seed, second, 0xb1a5_1c07) * 33); // 8..40 USDC/pick
    stake[second] = picks * usd * 1_000_000;
  }

  count[profile.peakSecond] = profile.peakCount;
  const peakUsd = 8 + Math.floor(randomAt(seed, profile.peakSecond, 0xb1a5_1c07) * 33);
  stake[profile.peakSecond] = profile.peakCount * peakUsd * 1_000_000;
  return { count, stake };
}

const CACHE = new Map<string, SecondCrowd>();

/** Sparse per-second crowd for a tool + lane. Cached — the build loops 7,441 seconds. */
export function crowdSeconds(kind: EventKind, side: Side): SecondCrowd {
  const k: Kind = kind === "sub" ? "goal" : kind;
  const key = `${k}:${side}`;
  let value = CACHE.get(key);
  if (!value) {
    value = build(k, side);
    CACHE.set(key, value);
  }
  return value;
}
