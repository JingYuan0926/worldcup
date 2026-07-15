/**
 * Exact Match — deterministic median-error payout math (README §5.3).
 *
 * This is the ONE TypeScript implementation. The Anchor program mirrors it
 * exactly in Rust; both are validated against the same `docs/payout-vectors.json`
 * so the two can never drift. Everything is integer-only.
 *
 * ── Overflow note (why BigInt / u128) ─────────────────────────────────────────
 * With USDT (6 decimals), stake ≤ 100 USDT = 100_000_000 base units and
 * ACC(0) = 1_000_000, so a single winner weight ≤ 1e14. The intermediate
 * `losers_pot * weight_i` can reach ~6.4e9 * 1e14 = 6.4e23, which overflows both
 * u64 AND JS's safe-integer range (9.0e15). TS uses BigInt; Rust MUST use u128
 * for this product. Final payouts fit comfortably in u64.
 *
 * The math is pool-kind agnostic. COUNT pools pass raw guesses; WHEN pools pass
 * 5-minute **bucket indices** (0–17 regulation, 18 = stoppage/beyond,
 * 19 deliberately unused, 20 = NEVER)
 * as both `guess` and `actual`, so `|guess - actual|` already encodes the
 * "NEVER vs bucket b = 20 - b" rule (README §5.3).
 */

/** Scale of the accuracy weight numerator. ACC(0) = ACC_SCALE. */
export const ACC_SCALE = 1_000_000n;

export interface EntryInput {
  /** Predicted value (COUNT: raw guess; WHEN: bucket index, NEVER = 20). */
  guess: number;
  /** Stake in token base units (e.g. micro-USDT). */
  stake: bigint;
}

export interface EntryResult {
  guess: number;
  stake: bigint;
  /** |guess - actual|. */
  error: number;
  /** error <= median_error. */
  isWinner: boolean;
  /** stake * ACC(error), 0 for losers. */
  weight: bigint;
  /** Total tokens this entry may claim (0 for losers). */
  payout: bigint;
}

export interface PayoutResult {
  actual: number;
  medianError: number;
  losersPot: bigint;
  totalWeight: bigint;
  /** Total staked across all entries (the vault balance). */
  vault: bigint;
  /** Total paid out; `vault - totalPayout` is rounding dust left in the vault. */
  totalPayout: bigint;
  dust: bigint;
  entries: EntryResult[];
}

/** ACC(e) = 1_000_000 / (1 + e*e), integer division. Steep so exactness matters. */
export function acc(error: number): bigint {
  const e = BigInt(error);
  return ACC_SCALE / (1n + e * e);
}

/**
 * Median of a list of non-negative integer errors.
 * Even count → the LOWER of the two middle values (README §5.3), which is the
 * element at index (n/2 - 1) in the ascending-sorted list.
 */
export function medianError(errors: number[]): number {
  if (errors.length === 0) return 0;
  const sorted = [...errors].sort((a, b) => a - b);
  const n = sorted.length;
  const idx = n % 2 === 1 ? (n - 1) / 2 : n / 2 - 1;
  return sorted[idx] as number;
}

/**
 * Compute the full payout distribution for one settled pool.
 *
 * Winners = entries with error ≤ median error. Each winner gets their stake back
 * plus a share of the losers' pot weighted by `stake * ACC(error)`. Losers get 0.
 * Rounding dust from floor division stays in the vault (no protocol fee — §5.3).
 */
export function computePayouts(entries: EntryInput[], actual: number): PayoutResult {
  const errors = entries.map((e) => Math.abs(e.guess - actual));
  const median = medianError(errors);

  const vault = entries.reduce((s, e) => s + e.stake, 0n);

  // Winners / losers split.
  let losersPot = 0n;
  let totalWeight = 0n;
  const weights: bigint[] = entries.map((e, i) => {
    const isWinner = (errors[i] as number) <= median;
    if (isWinner) {
      const w = e.stake * acc(errors[i] as number);
      totalWeight += w;
      return w;
    }
    losersPot += e.stake;
    return 0n;
  });

  const resultEntries: EntryResult[] = entries.map((e, i) => {
    const error = errors[i] as number;
    const isWinner = error <= median;
    const weight = weights[i] as bigint;
    let payout = 0n;
    if (isWinner) {
      // stake back + weighted share of losers' pot. u128-safe product.
      const share = totalWeight === 0n ? 0n : (losersPot * weight) / totalWeight;
      payout = e.stake + share;
    }
    return { guess: e.guess, stake: e.stake, error, isWinner, weight, payout };
  });

  const totalPayout = resultEntries.reduce((s, e) => s + e.payout, 0n);

  return {
    actual,
    medianError: median,
    losersPot,
    totalWeight,
    vault,
    totalPayout,
    dust: vault - totalPayout,
    entries: resultEntries,
  };
}

/** WHEN-pool bucket index for the NEVER outcome/guess (README §5.3). */
export const NEVER_BUCKET = 20;
