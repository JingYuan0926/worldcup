//! Exact Match — deterministic median-error payout math (README §5.3).
//!
//! This is the Rust mirror of `packages/payout/src/index.ts`. Both are validated
//! against the same `docs/payout-vectors.json` so the two can never drift; the
//! vector file is the contract between them, not this comment.
//!
//! ── Overflow note (why u128) ────────────────────────────────────────────────
//! With USDT (6 decimals), stake ≤ 100 USDT = 100_000_000 base units and
//! ACC(0) = 1_000_000, so a single winner weight ≤ 1e14. The intermediate
//! `losers_pot * weight_i` can reach ~6.4e23, which overflows u64. The product
//! is done in u128; final payouts fit comfortably in u64.

/// Scale of the accuracy weight numerator. ACC(0) = ACC_SCALE.
pub const ACC_SCALE: u128 = 1_000_000;

/// WHEN-pool bucket index for the NEVER outcome/guess (README §5.3).
pub const NEVER_BUCKET: i32 = 20;

/// Max entries per pool (README §6). Bounds the Pool account and the O(n) claim.
pub const MAX_ENTRIES: usize = 64;

/// ACC(e) = 1_000_000 / (1 + e*e), integer division. Steep so exactness matters.
pub fn acc(error: u32) -> u128 {
    let e = error as u128;
    ACC_SCALE / (1 + e * e)
}

/// Median of non-negative integer errors.
///
/// Even count → the LOWER of the two middle values (README §5.3), i.e. the
/// element at index `n/2 - 1` of the ascending-sorted list. This is deliberate:
/// the TS `medianError` does the same, and the `median-even-lower` vector pins it.
pub fn median_error(errors: &[u32]) -> u32 {
    if errors.is_empty() {
        return 0;
    }
    let mut sorted = errors.to_vec();
    sorted.sort_unstable();
    let n = sorted.len();
    let idx = if n % 2 == 1 { (n - 1) / 2 } else { n / 2 - 1 };
    sorted[idx]
}

/// |guess - actual|, saturating. Works for COUNT (raw values) and WHEN (bucket
/// indices), so `NEVER vs bucket b = 20 - b` falls out of the same subtraction.
pub fn error_of(guess: i32, actual: i32) -> u32 {
    (guess as i64 - actual as i64).unsigned_abs() as u32
}

/// One entry's settled outcome.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Outcome {
    pub error: u32,
    pub is_winner: bool,
    pub weight: u128,
    pub payout: u64,
}

/// Compute the payout for a single entry index, recomputed from scratch.
///
/// The program stores no payouts: `claim` recomputes this deterministically from
/// `entries + actual` every time, so a stored total can never disagree with the
/// math. O(n) over entries, n ≤ MAX_ENTRIES.
///
/// Winners = entries with error ≤ median error. Each winner gets their stake back
/// plus a share of the losers' pot weighted by `stake * ACC(error)`. Losers get 0.
/// Rounding dust from floor division stays in the vault (no protocol fee — §5.3).
pub fn payout_for(guesses: &[i32], stakes: &[u64], actual: i32, index: usize) -> Outcome {
    debug_assert_eq!(guesses.len(), stakes.len());

    let errors: Vec<u32> = guesses.iter().map(|g| error_of(*g, actual)).collect();
    let median = median_error(&errors);

    let mut losers_pot: u128 = 0;
    let mut total_weight: u128 = 0;
    for i in 0..guesses.len() {
        if errors[i] <= median {
            total_weight += stakes[i] as u128 * acc(errors[i]);
        } else {
            losers_pot += stakes[i] as u128;
        }
    }

    let error = errors[index];
    let is_winner = error <= median;
    if !is_winner {
        return Outcome { error, is_winner: false, weight: 0, payout: 0 };
    }

    let weight = stakes[index] as u128 * acc(error);
    // u128 product: losers_pot * weight can reach ~6.4e23.
    let share = if total_weight == 0 { 0 } else { losers_pot * weight / total_weight };
    let payout = stakes[index] as u128 + share;

    Outcome {
        error,
        is_winner: true,
        weight,
        // Payout is bounded by the vault (Σ stakes), which fits u64 by construction.
        payout: payout as u64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct VectorEntry {
        guess: i32,
        stake: String,
    }

    /// Mirrors the optional shape the TS suite accepts: vectors express per-entry
    /// expectations either explicitly (`winners`/`payouts`) or, for the 64-entry
    /// case, collapsed (`allWinners`/`eachPayout`).
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Expected {
        median_error: u32,
        losers_pot: String,
        vault: String,
        total_payout: String,
        dust: String,
        winners: Option<Vec<bool>>,
        payouts: Option<Vec<String>>,
        all_winners: Option<bool>,
        each_payout: Option<String>,
    }

    #[derive(Deserialize)]
    struct Generate {
        count: usize,
        guess: i32,
        stake: String,
    }

    #[derive(Deserialize)]
    struct Vector {
        name: String,
        actual: i32,
        entries: Option<Vec<VectorEntry>>,
        generate: Option<Generate>,
        expected: Expected,
    }

    impl Vector {
        /// Same expansion as the TS `entriesOf`.
        fn entries_of(&self) -> (Vec<i32>, Vec<u64>) {
            if let Some(g) = &self.generate {
                let stake = g.stake.parse::<u64>().expect("stake parses");
                return (vec![g.guess; g.count], vec![stake; g.count]);
            }
            let entries = self.entries.as_deref().unwrap_or(&[]);
            (
                entries.iter().map(|e| e.guess).collect(),
                entries.iter().map(|e| e.stake.parse::<u64>().expect("stake parses")).collect(),
            )
        }
    }

    #[derive(Deserialize)]
    struct Vectors {
        vectors: Vec<Vector>,
    }

    /// The drift guard: the exact same file drives `packages/payout`'s vitest suite.
    /// If Rust and TS ever disagree, one of these two suites goes red.
    #[test]
    fn matches_shared_payout_vectors() {
        let raw = include_str!("../../../../docs/payout-vectors.json");
        let parsed: Vectors = serde_json::from_str(raw).expect("payout-vectors.json parses");
        assert!(!parsed.vectors.is_empty(), "vector file is empty");

        for v in &parsed.vectors {
            let (guesses, stakes) = v.entries_of();

            let errors: Vec<u32> = guesses.iter().map(|g| error_of(*g, v.actual)).collect();
            assert_eq!(
                median_error(&errors),
                v.expected.median_error,
                "[{}] median error",
                v.name
            );

            let vault: u64 = stakes.iter().sum();
            assert_eq!(vault, v.expected.vault.parse::<u64>().unwrap(), "[{}] vault", v.name);

            let mut losers_pot: u128 = 0;
            let median = median_error(&errors);
            for i in 0..guesses.len() {
                if errors[i] > median {
                    losers_pot += stakes[i] as u128;
                }
            }
            assert_eq!(
                losers_pot,
                v.expected.losers_pot.parse::<u128>().unwrap(),
                "[{}] losers pot",
                v.name
            );

            let mut total_payout: u128 = 0;
            for i in 0..guesses.len() {
                let out = payout_for(&guesses, &stakes, v.actual, i);

                if let Some(winners) = &v.expected.winners {
                    assert_eq!(out.is_winner, winners[i], "[{}] winner[{}]", v.name, i);
                }
                if let Some(payouts) = &v.expected.payouts {
                    assert_eq!(
                        out.payout,
                        payouts[i].parse::<u64>().unwrap(),
                        "[{}] payout[{}]",
                        v.name,
                        i
                    );
                }
                if let Some(all_winners) = v.expected.all_winners {
                    assert_eq!(out.is_winner, all_winners, "[{}] allWinners[{}]", v.name, i);
                }
                if let Some(each) = &v.expected.each_payout {
                    assert_eq!(
                        out.payout,
                        each.parse::<u64>().unwrap(),
                        "[{}] eachPayout[{}]",
                        v.name,
                        i
                    );
                }

                // Universal invariants, asserted for every entry of every vector.
                if out.is_winner {
                    assert!(out.payout >= stakes[i], "[{}] winner[{}] below stake", v.name, i);
                } else {
                    assert_eq!(out.payout, 0, "[{}] loser[{}] paid", v.name, i);
                }

                total_payout += out.payout as u128;
            }
            assert_eq!(
                total_payout,
                v.expected.total_payout.parse::<u128>().unwrap(),
                "[{}] total payout",
                v.name
            );
            assert_eq!(
                vault as u128 - total_payout,
                v.expected.dust.parse::<u128>().unwrap(),
                "[{}] dust",
                v.name
            );
        }
    }

    /// Conservation is the property that actually protects the vault: paying out
    /// more than was staked would drain other pools' funds.
    #[test]
    fn never_pays_out_more_than_the_vault() {
        let guesses = [0, 3, 7, 12, 20];
        let stakes = [1_000_000u64, 25_000_000, 100_000_000, 5_000_000, 50_000_000];
        for actual in -5..=25 {
            let vault: u64 = stakes.iter().sum();
            let total: u128 = (0..guesses.len())
                .map(|i| payout_for(&guesses, &stakes, actual, i).payout as u128)
                .sum();
            assert!(total <= vault as u128, "actual={} overpaid", actual);
        }
    }

    #[test]
    fn all_same_error_refunds_everyone() {
        let guesses = [2, 4];
        let stakes = [10_000_000u64, 10_000_000];
        // actual = 3 → both error 1 → both winners, no losers pot → stake back.
        for i in 0..2 {
            assert_eq!(payout_for(&guesses, &stakes, 3, i).payout, stakes[i]);
        }
    }

    #[test]
    fn acc_is_steep() {
        assert_eq!(acc(0), 1_000_000);
        assert_eq!(acc(1), 500_000);
        assert_eq!(acc(2), 200_000);
        assert_eq!(acc(3), 100_000);
    }

    /// NEVER vs bucket b must be error 20 - b: a late guess is less wrong than an
    /// early one when the event never comes.
    #[test]
    fn never_bucket_distance() {
        assert_eq!(error_of(NEVER_BUCKET, NEVER_BUCKET), 0);
        assert_eq!(error_of(NEVER_BUCKET, 18), 2);
        assert_eq!(error_of(NEVER_BUCKET, 0), 20);
    }
}
