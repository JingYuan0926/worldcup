import { computePayouts, type EntryInput } from "@exact-match/payout";
import { USDT_UNIT, type Entry } from "./types";

function toBaseUnits(usdtAmount: number): bigint {
  return BigInt(Math.round(usdtAmount * USDT_UNIT));
}
function fromBaseUnits(base: bigint): number {
  return Number(base) / USDT_UNIT;
}

export interface PreviewResult {
  /** payout in USDT if the outcome equals `assumedActual`. */
  payoutUsdt: number;
  /** payout / stake (e.g. 2.4×). */
  multiple: number;
  /** would this entry be a winner at that outcome? */
  isWinner: boolean;
  medianError: number;
  vaultUsdt: number;
}

/**
 * "If it lands exactly here, you'd win ≈ X USDT now" — recomputes the §5.3
 * payout client-side over the current crowd plus the user's hypothetical entry.
 *
 * @param assumedActual the outcome to price against (defaults to the user's own
 *   guess, i.e. "if you're exactly right").
 */
export function previewPayout(
  crowd: Entry[],
  myGuess: number,
  myStakeUsdt: number,
  assumedActual?: number,
): PreviewResult {
  const actual = assumedActual ?? myGuess;
  const entries: EntryInput[] = [
    ...crowd.map((e) => ({ guess: e.guess, stake: toBaseUnits(e.stake) })),
    { guess: myGuess, stake: toBaseUnits(myStakeUsdt) },
  ];
  const res = computePayouts(entries, actual);
  const mine = res.entries[res.entries.length - 1];
  const payoutUsdt = mine ? fromBaseUnits(mine.payout) : 0;
  return {
    payoutUsdt,
    multiple: myStakeUsdt > 0 ? payoutUsdt / myStakeUsdt : 0,
    isWinner: mine?.isWinner ?? false,
    medianError: res.medianError,
    vaultUsdt: fromBaseUnits(res.vault),
  };
}

/** Crowd histogram: total stake per discrete value/bucket. */
export function crowdHistogram(
  crowd: Entry[],
  min: number,
  max: number,
): { value: number; count: number; stake: number }[] {
  const bins = new Map<number, { count: number; stake: number }>();
  for (let v = min; v <= max; v++) bins.set(v, { count: 0, stake: 0 });
  for (const e of crowd) {
    const b = bins.get(e.guess);
    if (b) {
      b.count += 1;
      b.stake += e.stake;
    }
  }
  return [...bins.entries()].map(([value, b]) => ({ value, ...b }));
}

/** Total pot (vault) in USDT for a set of entries. */
export function potUsdt(crowd: Entry[]): number {
  return crowd.reduce((s, e) => s + e.stake, 0);
}
