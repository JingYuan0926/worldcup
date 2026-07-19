import type { EventKind } from "@/components/Icons";
import { MATCH_SECONDS, type Side } from "@/lib/demo";
import { bucketRange } from "@/lib/pools";

/**
 * A single stake, placed at a specific match second on one lane.
 *
 * Modelling bets as points in time (rather than pre-summed 5-minute buckets) is
 * what lets the timeline aggregate them into candles at any resolution: one
 * candle per few seconds when zoomed in, one per several minutes when zoomed out.
 */
export interface BetEvent {
  second: number;
  side: Side;
  /** base units (micro-USDC) — same unit as an on-chain entry's stake. */
  stake: number;
}

const LAST_BUCKET = 18;

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
    case "goal":
      return Math.exp(-((x - 0.16) ** 2) / 0.02) + 0.85 * Math.exp(-((x - 0.82) ** 2) / 0.03);
    case "yellow":
      return 0.25 + 1.1 * x + 0.6 * Math.exp(-((x - 0.9) ** 2) / 0.015);
    case "red":
      return 0.06 + Math.exp(-((x - 0.86) ** 2) / 0.012);
    case "corner":
      return 0.7 + 0.45 * Math.sin(x * Math.PI * 3.2) + 0.35 * x;
    default:
      return 0.5;
  }
}

/**
 * Deterministic simulated bets for a tool that has no real pools (corner/card).
 * Each 5-minute window gets a bet count proportional to the event's shape, and
 * every bet is dropped at a concrete second inside that window so it aggregates
 * cleanly at any candle resolution. No RNG — seeded sines, so SSR and client agree.
 */
export function simulatedBets(kind: EventKind): BetEvent[] {
  const out: BetEvent[] = [];
  for (const side of ["home", "away"] as Side[]) {
    const seed = KIND_SEED[kind] + (side === "home" ? 0 : 6.4);
    for (let b = 0; b <= LAST_BUCKET; b++) {
      const x = b / LAST_BUCKET;
      const intensity = Math.max(0, shape(kind, x));
      const wobble = 0.5 + 0.5 * Math.sin(seed * 1.9 + b * 2.17);
      const n = Math.round(intensity * (0.6 + 0.8 * wobble) * 3);
      const { start, end } = bucketRange(b);
      for (let k = 0; k < n; k++) {
        const frac = (k + 0.5) / Math.max(1, n);
        const jitter = 0.06 * Math.sin(seed * 3.1 + b * 5.7 + k * 2.9);
        const p = Math.min(0.999, Math.max(0, frac + jitter));
        const second = Math.round(start + (end - start) * p);
        const j2 = 0.5 + 0.5 * Math.sin(seed * 0.7 + b * 1.3 + k * 0.9);
        const stakeUsdc = 5 + Math.round(45 * j2); // 5..50 USDC
        out.push({
          second: Math.min(MATCH_SECONDS, Math.max(0, second)),
          side,
          stake: stakeUsdc * 1_000_000,
        });
      }
    }
  }
  return out;
}
