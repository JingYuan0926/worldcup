# Exact Match — Settlement Specification

> **Status: DRAFT / provisional (2026-07-09).** The COUNT and WHEN mechanisms below
> are locked against the *verified* devnet txoracle IDL (`v1.4.2`). The **phase-settlement
> rule (§5)** and a handful of encoding details (§7) are marked **PROVISIONAL** and must be
> confirmed against a real Merkle proof from a finished World Cup fixture before the
> settle instructions are frozen. This is a **judging deliverable** (README §3, §6, §8 spike #6):
> it documents exactly how a valid TxLINE proof — and nothing else — moves the money.

## 0. Guarantee

Exact Match pools settle **trustlessly**. There is **no admin key on any instruction**, no
oracle vote, no fee switch (README §6). A pool moves from `Open` to `Settled` only when a
transaction carries a TxLINE Merkle proof that verifies against TxLINE's **on-chain**
`daily_scores_merkle_roots` PDA. A forged stat value fails on-chain with txoracle error
`6023 InvalidStatProof` / `6021 PredicateFailed` — the demo's "market that cannot cheat"
beat. Everything here is deterministic: given the same proof and the same entries, every
verifier computes the same outcome.

Two pool kinds share one program, one proof primitive, and one payout function:

| Kind | Question | Input | Settles with |
|---|---|---|---|
| **COUNT** | "how many?" | slider | **one** exact-value proof (`EqualTo`) |
| **WHEN** | "in which 5-minute window does the Nth event happen?" | timeline marker | **two** bracketing proofs (or one terminal proof for NEVER) |

---

## 1. The on-chain primitive: `txoracle::validate_stat`

Verified against `services/ingest/src/txline/idl/txoracle.devnet.json` (program `txoracle`,
metadata version **1.4.2**, spec `0.1.0`). Accounts, arg order and types below are read
directly from that IDL — this is the single source of truth for building the settle CPI.

**Accounts (1):** `daily_scores_merkle_roots` — read-only, no signer. Derivation in §6.

**Args (in order):**

| # | Arg | Type | Source |
|---|-----|------|--------|
| 1 | `ts` | `i64` | `fixture_summary.update_stats.min_timestamp` (ms) |
| 2 | `fixture_summary` | `ScoresBatchSummary` | from the `stat-validation` API payload |
| 3 | `fixture_proof` | `Vec<ProofNode>` | " |
| 4 | `main_tree_proof` | `Vec<ProofNode>` | " |
| 5 | `predicate` | `TraderPredicate` | **built by us** from `claimed_actual` |
| 6 | `stat_a` | `StatTerm` | from the API payload |
| 7 | `stat_b` | `Option<StatTerm>` | present for two-key pools (corners, goals) |
| 8 | `op` | `Option<BinaryExpression>` | `Add` for two-key pools, else `None` |

**Struct/enum shapes (exact, from the IDL):**

```
ScoresBatchSummary { fixture_id: i64, update_stats: ScoresUpdateStats, events_sub_tree_root: [u8;32] }
ScoresUpdateStats  { update_count: i32, min_timestamp: i64, max_timestamp: i64 }
TraderPredicate    { threshold: i32, comparison: Comparison }
Comparison         = GreaterThan | LessThan | EqualTo          // enum
BinaryExpression   = Add | Subtract                            // enum
StatTerm           { stat_to_prove: ScoreStat, event_stat_root: [u8;32], stat_proof: Vec<ProofNode> }
ScoreStat          { key: u32, value: i32, period: i32 }
ProofNode          { hash: [u8;32], is_right_sibling: bool }
```

Two field-name renames to watch (README gotcha #4): the API returns the sub-tree root as
`eventStatsSubTreeRoot`, but the on-chain field is **`events_sub_tree_root`** — rename when
constructing the ix. Proof hashes arrive base64 or `0x`-hex and must decode to **exactly 32
bytes**.

**Return value — VERIFY (see GO/NO-GO §6).** README §7.5 states `validate_stat` returns
`bool`, and Path A reads it via `get_return_data()` / `.view()`. The devnet IDL we hold
declares **no `returns` type** on the instruction. This is almost certainly an IDL
omission (the program can still `set_return_data` a bool at runtime), but because our whole
primary path depends on reading that bool, **confirming the actual return of a real
`.view()` call is the single most important open item** and is unblocked today (no deploy
needed — it calls the already-deployed devnet program).

> **Note on `validate_stat_v2` (native closeness scoring, README §5.1/§7.5 stretch):** it is
> **not present** in this devnet IDL — only `validate_stat` exists (full instruction list
> verified). The `NDimensionalStrategy` / `geometric_targets` path is therefore treated as
> unavailable for v1; the `EqualTo` + bracketing design below is the whole settlement story.
> Logged in `docs/txline-feedback.md`.

---

## 2. COUNT pool settlement — single proof, `EqualTo`

A COUNT pool holds `stat_key_a`, optional `stat_key_b`, and `op` (see the §5.1 pool table).
Settlement is **one** `validate_stat` CPI asserting the summed stat **exactly equals** the
claimed answer.

`settle(target_ts, fixture_summary, fixture_proof, main_tree_proof, claimed_actual)` (README §6):

1. Require `now >= lock_ts`, pool `state == Open`.
2. Build the predicate: **`{ threshold: claimed_actual, comparison: EqualTo }`**.
3. Build stat terms from the passed proof payload; require
   `stat_a.stat_to_prove.key == pool.stat_key_a` and, if two-key,
   `stat_b.stat_to_prove.key == pool.stat_key_b` and `op == Add`. (Binds the proof to *this*
   pool's stat — a proof for a different stat/fixture cannot settle it.)
4. Require `fixture_summary.fixture_id == pool.fixture_id`.
5. Enforce the **phase-settlement rule** (§5) for the pool's `settle_phase`.
6. CPI `txoracle::validate_stat(...)` with the `daily_scores_merkle_roots` PDA (§6); require
   the returned bool `== true`.
7. Set `actual = claimed_actual`, `state = Settled`.

Any tampering fails at step 6 with `6023 InvalidStatProof` (bad stat leaf), `6003/6004`
(bad sub-tree / main-tree proof) or `6021 PredicateFailed` (real value ≠ claimed).

### Worked example — total corners == 11 (P0 pool "Total match corners")

Pool: `stat_key_a = 7` (Participant 1 corners), `stat_key_b = 8` (Participant 2 corners),
`op = Add`, full-game period `0`, `settle_phase = 5 (F)`. Suppose the finished match ended
6 corners to 5.

```
predicate = { threshold: 11, comparison: EqualTo }
stat_a    = { stat_to_prove: { key: 7, value: 6, period: 0 }, event_stat_root, stat_proof }
stat_b    = Some({ stat_to_prove: { key: 8, value: 5, period: 0 }, event_stat_root, stat_proof })
op        = Some(Add)
```

The txoracle verifies each leaf against `events_sub_tree_root`, that root against the daily
root PDA, then checks `Add(6, 5) == 11` under `EqualTo` → returns `true`. `settle` writes
`actual = 11`; `claim()` runs the §4 payout. A caller who submits `claimed_actual = 10`
fails `PredicateFailed` (the leaves still prove 6 and 5); a caller who submits forged leaf
values fails `InvalidStatProof`.

The first-half-goals P0 pool (`stat_key_a = 1001`, `stat_key_b = 1002`, `settle_phase = 3
(HT)`, range 0–6) is the same shape at halftime — the mid-broadcast "flash settlement"
demo moment.

---

## 3. WHEN pool settlement — two bracketing proofs at 5-minute granularity

WHEN pools answer "which 5-minute window did the Nth event land in?" The honest limit of
the on-chain data (README §5.1): roots are posted **per 5-minute batch**, and a stat leaf
carries **no event timestamp** — only the batch's `min/max_timestamp` window is provable.
So we cannot prove "the goal was at 37:12". We *can* prove, with two leaves, that the count
**crossed from N-1 to N inside one 5-minute batch**, and that batch's window is the answer.

`settle_when(proof_a…, proof_b…, claimed_bucket)` (README §6). For the Nth event of a WHEN
pool with cumulative stat key(s):

- **Proof A** — asserts the count had **not yet** reached N *before* the claimed window:
  `stat == N-1` (`{ threshold: N-1, comparison: EqualTo }`) proved on a batch whose
  window ends **strictly before** the claimed bucket's window.
- **Proof B** — asserts the count **reached** N *inside* the claimed window:
  `stat >= N` (`{ threshold: N-1, comparison: GreaterThan }`) proved on a batch whose window
  lies **inside** the claimed bucket. `GreaterThan N-1` (rather than `EqualTo N`) tolerates
  two events landing in the same batch.
- The instruction requires the two batch windows to be **consistent**: A's window strictly
  before B's, and B's window equal to `claimed_bucket`'s window. The answer is B's 5-minute
  bucket index relative to kickoff.

**NEVER variant — one proof.** If the event never happens, there is no crossing to bracket.
Settle with a **single terminal-phase proof**: `stat <= N-1` (`{ threshold: N, comparison:
LessThan }`) taken at the final batch of the settle phase. This sets `actual = NEVER`.

> Two full proofs (3 proof vectors each, 33 bytes/node) may exceed one transaction's CU or
> the 1232-byte packet budget. README spike #4 decides one-tx vs a two-step commit (store
> verified proof-A's hash, then finish with proof-B). Design target: single tx; fallback documented.

### 3.1 The 5-minute bucket model — UI shows minutes, **money settles buckets**

This is the load-bearing honesty statement for WHEN pools and **must** be surfaced in the UI
(tooltip: "settles by 5-minute window"):

- The **timeline canvas** (README §5.4) lets users drop a marker at any minute; the marker
  **snaps to a 5-minute bucket**. During the watch phase the live SSE feed may pin a true
  event to its exact minute for spectacle — but **the payout is computed on bucket indices,
  not minutes.** A marker at 22' and a marker at 24' are the **same entry** (bucket 4).
- Bucket = which 5-minute batch the event's count-crossing was proved in, measured from
  kickoff. Formally, using the batch's window and the pool's `lock_ts` (kickoff):

  ```
  bucket_index = floor((batch_min_timestamp_ms - lock_ts_ms) / 300_000)   // 300_000 ms = 5 min
  ```

### 3.2 Bucket indexing (money-settlement domain)

The indices below are the domain of the payout function (`packages/payout` treats a WHEN
guess/actual as a bucket index; `NEVER_BUCKET = 20`). The UI's "18 five-minute windows"
copy maps onto them:

| Index | Meaning |
|---|---|
| `0 … 17` | The **eighteen** 5-minute regulation windows from kickoff (`bucket 0` = 0–5', … `bucket 17` = 85–90'). This is `REGULATION_BUCKETS = 18` in `packages/payout`. |
| `18` | **Stoppage / beyond** (`BEYOND_BUCKET`) — 90:00 onward; extra time and anything past regulation folds here in v1 (per-ET buckets are a documented cut, README §5.1). |
| `19` | Deliberate **gap** — keeps NEVER non-adjacent to the last real bucket so "NEVER vs a late window" stays a meaningful error under `20 - b`. |
| `20` | **NEVER** (`NEVER_BUCKET`) — the event did not occur by the settle phase. |

These constants are the frozen money-domain (`web/src/lib/types.ts` + `packages/payout`); the code and this table now agree.

Error/accuracy for WHEN uses the *same* median-error formula as COUNT with these indices as
`guess`/`actual`. NEVER (20) vs an early bucket `b` is a large error (`20 - b`); a late guess
is "less wrong" than an early one when the event never comes (README §5.3), which falls out
of `|guess - actual|` automatically.

> **PROVISIONAL — exact regulation boundary.** Whether 90:00 lands on bucket `17` or `18`,
> and exactly where regulation stoppage rolls into index `19`, depends on the real
> kickoff-relative batch timestamps (whether TxLINE batches align to wall-clock 5-min slots
> or to a kickoff-relative clock). Confirm against a recorded fixture's proof windows before
> freezing `settle_when`. The **money code constant** (`NEVER_BUCKET = 20`) and the formula
> above are fixed; only the regulation↔stoppage index boundary is open.

---

## 4. Payout / resolution math (deterministic)

Settlement sets only `actual` on-chain. **No payouts are stored.** `claim()` recomputes each
entrant's payout deterministically from the pool's `entries` + `actual`, so every observer
derives identical numbers.

The one implementation lives in **`packages/payout/src/index.ts`** (`computePayouts`,
`acc`, `medianError`, `NEVER_BUCKET`) — integer-only, BigInt for the `losers_pot × weight`
product that overflows `u64` (the Rust program MUST use `u128` there). The rule (README §5.3):

```
error_i  = |guess_i - actual|
median_e = median error (even count → LOWER of the two middle values)
winners  = { i : error_i <= median_e }
weight_i = stake_i * ACC(error_i)      ACC(e) = 1_000_000 / (1 + e*e)   (integer div)
payout_i = stake_i + floor(losers_pot * weight_i / Σ weights)   (winners; losers = 0)
```

Rounding dust from floor division stays in the vault (no fee — strengthens the no-admin
story). Edge cases (all-tie → full refunds; single entry → refund; ties at the median
included via `<=`) are covered by **`docs/payout-vectors.json`**.

**`docs/payout-vectors.json` is the drift guard.** The TS module and the Rust program are
both validated against the same vectors (normal, all-tie, single-entry, odd/even median,
crowded-vs-lone, WHEN NEVER/bucket outcomes, max-entries). If the Rust port disagrees on
any vector, the port is wrong. These vectors gate the program's `cargo test` payout suite.

---

## 5. Phase-settlement rule (spike #6) — **PROVISIONAL**

A COUNT/WHEN proof establishes a *stat value* against a Merkle root. It does not, by itself,
establish that **the match reached the settle phase** — and settling a full-time pool from a
mid-match stat would be wrong (the count is not final until F/HT). The settle instructions
must additionally bind the proof to the terminal phase.

Game phases (README §7.4): `NS 1, H1 2, HT 3, H2 4, F 5, WET 6, ET1 7, HTET 8, ET2 9, FET
10, WPE 11, PE 12, FPE 13, …`. A pool's `settle_phase` is **3 (HT)** for the halftime pool
and **5 (F)** for full-time pools, with **FET (10)** and **FPE (13)** accepted as terminal
for knockout matches that run to extra time / penalties.

**Chosen approach (provisional):** bind settlement to a **Scores record whose
`statusSoccerId` equals the pool's settle phase at the settle `seq`**. Concretely, the
settler selects the `seq` whose Scores record carries `statusSoccerId == settle_phase`
(accepting 10/13 as terminal for FT), fetches the `stat-validation` proof at that `seq`, and
the settle instruction requires the proof to be bound to that phase. This gives us: the
stat value is read at the moment the match is (by TxLINE's own status field) in its settle
phase, so the value is final.

**Why provisional:** we have not yet seen how `validate_stat` binds phase in practice. The
open question is *what the proof actually commits to* — a specific `seq`'s full Scores
record (in which case proving any stat at that `seq` implies the record's `statusSoccerId`),
or merely a 5-minute batch window (in which case the phase is **not** pinned by the stat
proof and we need an independent binding).

**Must be verified against a real proof (before freezing settle):**

1. **Is `statusSoccerId` itself a provable stat leaf?** Does the `stats` map at the settle
   `seq` include a phase/status key that `validate_stat` can prove with an `EqualTo`
   predicate? If yes, the rule becomes a clean extra `validate_stat` assertion
   (`status == settle_phase`).
2. **What does the proof bind — a `seq` or a batch window?** If the txoracle binds the whole
   Scores record at a `seq`, proving a stat there is sufficient. If it only binds a
   `min/max_timestamp` window, we need a timestamp/period constraint (e.g. batch window past
   the scheduled end, or period-specific keys) as the phase evidence.
3. **HT finality:** confirm the H1 stat keys (`1001/1002`) are stable once `statusSoccerId ==
   3` and are not revised in H2 — otherwise the halftime pool could settle on a value that
   later changes.
4. **FT terminal set:** confirm that for matches ending in ET/penalties the terminal
   record's `statusSoccerId` is `10`/`13` (not `5`), so accepting them is correct.
5. **`statusSoccerId` wire shape** (string vs number vs object) — cross-referenced in
   `docs/wire-notes.md` (owned by the wire-format probe), needed to compare it on-chain.
6. **Refund phases:** A `15`, C `16`, P `19` (abandoned/cancelled/postponed) must route to
   refund, never settle (README §5.2).

Once (1)/(2) are answered by the proof round-trip + a live/recorded terminal record, this
section is upgraded from PROVISIONAL to the frozen settle-instruction requirement.

---

## 6. GO / NO-GO — settlement path

Three paths, in order of preference (README §6). All three are **fully trustless except C**,
which degrades trust honestly.

- **Path A — CPI into `txoracle::validate_stat` (PRIMARY design target).** Our program calls
  the deployed txoracle, passes the `daily_scores_merkle_roots` PDA, and requires the
  returned bool. Deepest integration, smallest trust surface — the judges were told custom
  validation on TxLINE's Merkle proofs is "highly valued."
- **Path B — self-verify (FALLBACK, still fully trustless).** Read the
  `daily_scores_merkle_roots` PDA account data directly in our program and re-walk the
  Merkle chain ourselves (reverse-engineer the hash scheme + PDA layout, README spike #2b/2c).
  If Path B ships, **say so proudly** — an independent verifier is exactly the "custom check
  gate" the track rewards.
- **Path C — off-chain verify (LAST RESORT).** Verify in the settler, store the full proof
  bytes in the settle tx for public auditability, document the trust delta prominently. Only
  if A and B both fail.

**Toolchain status (updated 2026-07-09):** the Solana / Anchor toolchain **is now installed
on this machine** — `anchor-cli 0.31.1`, `solana-cli 2.1.0` (Agave). This **unblocks README
spike #3** (the minimal CPI test program that is the true go/no-go for Path A). However, per
the user's directive, **on-chain program work (build/deploy/CPI test) is deferred to last**
(TASKS Phase 1 tail / "smart contract LAST").

**Immediate validation of Path A's interface — do this first, it needs no deploy:** the
`validate_stat(...).view()` proof round-trip (README spike #2). It calls the
*already-deployed* devnet txoracle with a real proof for a finished fixture (e.g. `17588310`
Tunisia–Japan, `18172489` Brazil–Japan, `18198205` Portugal–Spain) and confirms, off-chain,
that:

1. `validate_stat` **actually returns a readable `true`** for a correct proof (resolves the
   §1 "return value — VERIFY" concern before we depend on it in Path A).
2. `EqualTo` + `Add` semantics work as designed (the corners worked example, spike #5).
3. Devnet's txoracle anchors **real** World Cup fixtures (not only synthetic test data) —
   if not, the app records on mainnet and settles proofs there, a design fork we need to
   know early.
4. CU consumed (1-stat vs 2-stat) and tx size vs the 1232-byte limit (spike #4) — feeds the
   §3 one-tx-vs-two-step decision for WHEN pools.

Until that round-trip is green, **Path A is the design target but not confirmed**; Path B is
kept warm. The `.view()` spike is gated only on TxLINE tokens (run
`npm run auth -- --network devnet` first — the subscribe tx is currently unfunded).

### Root PDA derivation (needed by every path)

```ts
const epochDay = Math.floor(summary.updateStats.minTimestamp / 86_400_000);   // from the PROOF's ts
const [dailyScoresPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],  // u16 LE
  TXORACLE_PROGRAM_ID,
);
```

Roots are stored per 5-minute slot within each epoch-day PDA. Posting cadence/lag after a
live goal (error `6007 RootNotAvailable` → `200`) is measured in spike #4.

---

## 7. Open items checklist (freeze-blockers)

- [ ] `validate_stat` return value confirmed readable `true` via `.view()` (§1).
- [ ] `EqualTo` + `Add` semantics confirmed on a finished fixture (§2, spike #5).
- [ ] Devnet txoracle anchors real WC fixtures? (else record/settle on mainnet) (§6).
- [ ] WHEN bracketing proofs A+B verified on a real two-goal fixture; regulation↔stoppage
      bucket boundary fixed (§3.2).
- [ ] Phase-binding mechanism resolved: provable status leaf vs seq-binding vs timestamp
      constraint (§5, items 1–2).
- [ ] HT stat finality + FT terminal set (10/13) confirmed (§5, items 3–4).
- [ ] CU + tx-size budget for 1-stat, 2-stat, and WHEN two-proof settles (§3, spike #4).
- [ ] Proof hash encoding (base64 vs 0x-hex) normalised to 32 bytes end-to-end (§1).

---

*Money moves only on a valid proof. Where this doc says PROVISIONAL, the settle instruction
is not yet frozen — resolve the open item against real proof data first.*
