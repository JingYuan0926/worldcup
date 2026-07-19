import type { EventKind } from "@/components/Icons";
import type { Side } from "@/lib/demo";

/**
 * Simulated betting-crowd distribution per event type, per lane.
 *
 * Goal pools carry real on-chain entries, but corners and cards have no pools yet
 * (they are display-only — see lib/pools.ts). So the "where did the crowd bet"
 * curve for those events is synthesised here — deterministically, seeded by
 * (kind, side), so SSR and the client agree and switching tools swaps to a
 * stable, distinct shape rather than flickering. Each value is a per-5-minute-
 * bucket weight; the timeline normalises per lane, so only the shape matters.
 */

const BUCKETS = 20; // NEVER_BUCKET: indices 0..17 regulation, 18 stoppage/extra time.
const LAST = 18;

const KIND_SEED: Record<EventKind, number> = {
  goal: 3.1,
  yellow: 7.7,
  red: 13.3,
  corner: 5.5,
  sub: 2.2,
};

/** Base intensity over the match clock (x in 0..1), one signature per event. */
function shape(kind: EventKind, x: number): number {
  switch (kind) {
    // Two humps: an early flurry and a late push — the classic goal-time profile.
    case "goal":
      return Math.exp(-((x - 0.16) ** 2) / 0.02) + 0.85 * Math.exp(-((x - 0.82) ** 2) / 0.03);
    // Cards accumulate as the game tightens: low early, rising, spiking late.
    case "yellow":
      return 0.25 + 1.1 * x + 0.6 * Math.exp(-((x - 0.9) ** 2) / 0.015);
    // Rare and late — a single concentrated bump around 75–90'.
    case "red":
      return 0.06 + Math.exp(-((x - 0.86) ** 2) / 0.012);
    // Spread across attacking phases, with a gentle upward drift.
    case "corner":
      return 0.7 + 0.45 * Math.sin(x * Math.PI * 3.2) + 0.35 * x;
    default:
      return 0.5;
  }
}

/**
 * A per-bucket stake weight for a lane, distinct per event type and per side.
 * Deterministic (no RNG): the wobble is a fixed sine so both lanes read
 * differently while staying identical between renders.
 */
export function eventCrowd(kind: EventKind, side: Side): number[] {
  const arr = new Array<number>(BUCKETS).fill(0);
  const seed = KIND_SEED[kind] + (side === "home" ? 0 : 6.4);
  for (let b = 0; b <= LAST; b++) {
    const x = b / LAST;
    const base = Math.max(0, shape(kind, x));
    const wobble = 0.5 + 0.5 * Math.sin(seed * 1.9 + b * 2.17);
    // Scaled to base units (micro-USDC) so the hover tooltip reads as plausible
    // USDC per window (tens–hundreds), same unit as the real goal-pool stakes.
    arr[b] = base * (0.65 + 0.7 * wobble) * 100_000;
  }
  return arr;
}
