# Settler runbook — the permissionless crank

> How **anyone** runs the Exact Match settler: bootstrapping a fixture's pools, settling
> them from TxLINE Merkle proofs, and refunding when a match never settles.
>
> **This is a headline feature: the settler has no admin key.** It signs and pays for its
> own transactions, but it holds no special authority — every instruction it sends
> (`create_pool`, `settle`, `settle_when`, `refund`) is callable by any wallet. The program
> moves money only when a valid TxLINE proof verifies on-chain (`docs/settlement-spec.md`
> §0). Losing the settler wallet loses nothing; a competitor could settle your pools for
> you and the outcome is byte-for-byte identical.
>
> **Deploy gate.** The `exact_match` Anchor program is built **last** (TASKS #10). Until it
> is deployed and `EXACT_MATCH_PROGRAM_ID` is set, every command here runs in **dry-run**:
> it fetches real proofs, builds the real CPI args, derives the real PDAs, and prints the
> exact transaction it *would* submit — but sends nothing. Wiring in the program is a
> localized change (search the code for `TODO(program)`); nothing else moves.

---

## 1. What the settler is

Three pieces under `services/settler/src`, all pure-TS, reusing the shared TxLINE modules in
`services/ingest/src`:

| File | Role |
|---|---|
| `phase.ts` | Phase model (README §7.4), the curated pool templates (README §5.1), and the deterministic **settle-seq selector** — which `seq` carries the settling proof. Pure, no network. |
| `proofs.ts` | The read side: fetch `stat-validation` Merkle proofs (COUNT: one; WHEN: two bracketing + a NEVER terminal), the scores sequence for phase detection, and a fixture's kickoff `StartTime`. Normalizes every proof through the shared `normalizeStatValidation`. |
| `settle.ts` | The tx **builders** (deploy-gated scaffold). Assemble the `validate_stat` CPI args via `buildValidateStatArgs`, derive the `daily_scores_roots` PDA and the pool PDA + Token-2022 vault, and return a `SettlePlan`/`RefundPlan` **description object** of exactly what would be submitted. |
| `crank.ts` | The loop: fetch phase once, decide settle / refund / pending per pool, build the plan, log it, and (once deployed) submit. `runCrankOnce` is one evaluation; `runCrank` polls it. |
| `cli/settle.ts` | `settle` CLI — settle (or dry-run) a fixture's pools. |
| `cli/bootstrap.ts` | `bootstrap` CLI — print the `create_pool` set for an upcoming fixture. |

The settlement mechanics these encode are specified in **`docs/settlement-spec.md`** (COUNT §2,
WHEN §3, payout §4, the **PROVISIONAL** phase rule §5, PDA derivation §6). Read it alongside
this runbook — the spec is *why*, this is *how to run it*.

---

## 2. Prerequisites

### 2.1 Environment (`.env` at repo root)

The settler reuses `services/ingest/src/config.ts`, so it reads the same `.env` keys
(`.env.example` documents them). The ones that matter here:

| Var | Meaning | Default |
|---|---|---|
| `TXLINE_NETWORK` | `devnet` (app) or `mainnet` (recorder). CLIs also take `--network`. | `devnet` |
| `TXLINE_TOKENS_DIR` | Where the guest-JWT + api-token pair is saved per network. | `./.tokens` |
| `SOLANA_DEVNET_RPC` / `SOLANA_MAINNET_RPC` | RPC for tx submission (only needed once deployed). | network default |
| `DEVNET_WALLET_KEYPAIR` | The wallet the crank signs/pays with (any funded devnet keypair — **no authority**). | `./keypairs/devnet.json` |
| `EXACT_MATCH_PROGRAM_ID` | **Set only after the program is deployed.** Unset → dry-run scaffold. | *(unset)* |

### 2.2 TxLINE token (required for any live data)

Every data endpoint needs **both** headers (`Authorization: Bearer <jwt>` + `X-Api-Token`).
Those come from the auth flow (guest JWT → on-chain `subscribe` → `activate`), saved under
`TXLINE_TOKENS_DIR`. Get one with:

```bash
npm run auth -- --network devnet     # or --network mainnet
```

**No token?** Every settler command degrades gracefully: it prints
`No saved TxLINE token for <net> — run: npm run auth -- --network <net>` and **exits 0**
(the `bootstrap` CLI additionally falls back to a placeholder kickoff so it can still print
the pool plan). Subscribe is currently blocked on wallet funding, so this is the expected
state today — the commands are wired and typecheck-clean, ready the moment a token exists.

### 2.3 Running the CLIs

The `settle` / `bootstrap` scripts live in the `services/settler` workspace. From the repo
root:

```bash
npm run settle    --workspace services/settler -- --fixture 17588310 --network devnet
npm run bootstrap --workspace services/settler -- --fixture 18209181 --network devnet
```

Or from inside `services/settler/` the shorter `npm run settle -- …` / `npm run bootstrap -- …`.
Everything after `--` is passed to the CLI. (Both are also directly runnable with
`npx tsx src/cli/settle.ts --fixture …`.)

---

## 3. Bootstrap — create a fixture's pools

**When:** once, before kickoff, for each fixture you want to run pools on.

```bash
npm run bootstrap --workspace services/settler -- --fixture 18209181 --network devnet
```

It prints the curated **seven-pool** set (README §5.1) with every on-chain `create_pool`
parameter resolved:

| # | Pool | Kind | Stat | Settles | Range |
|---|---|---|---|---|---|
| 0 | Total match goals | COUNT | `1 + 2` | F (5) / FET (10) / FPE (13) | 0–10 |
| 1 | Total match corners | COUNT | `7 + 8` | F/FET/FPE | 0–25 |
| 2 | First-half goals | COUNT | `1001 + 1002` | HT (3) | 0–6 |
| 3 | Window of the 1st goal | WHEN | `1 + 2` | F/FET/FPE | buckets 0–18, 20 |
| 4 | Window of the 1st yellow | WHEN | `3 + 4` | F/FET/FPE | buckets 0–18, 20 |
| 5 | Window of the 1st corner | WHEN | `7 + 8` | F/FET/FPE | buckets 0–18, 20 |
| 6 | Window of the 1st red | WHEN | `5 + 6` | F/FET/FPE | buckets 0–18, 20 |

For each it resolves `fixture_id`, the **frozen** `pool_index` (baked into the PDA seed —
never renumber), the stat spec, `lock_ts` = kickoff `StartTime`, `settle_phase`,
`settle_deadline_ts` = `lock_ts + 12h`, the slider range, and (once `EXACT_MATCH_PROGRAM_ID`
is set) the pool PDA + Token-2022 vault ATA. Output is both a human log and a machine-readable
JSON block.

- **With a token:** kickoff is read from `/api/fixtures/snapshot` (`StartTime`). Knockout
  fixture ids only appear in the snapshot after the previous round resolves (README §7.7) —
  if the fixture isn't there yet it warns and uses a placeholder.
- **Without a token / not in snapshot:** it uses a clearly-labelled placeholder kickoff and
  still prints the full plan. Override anytime with `--lock-ts <unix_ms>`.

**Deploy-gated:** `create_pool` is a program instruction. Bootstrap **describes** the plan; it
does not send. Once deployed, each entry submits as
`exactMatchProgram.methods.createPool(...params).accounts({ pool, usdtMint, … }).rpc()`
(`TODO(program)` in `cli/bootstrap.ts`). `create_pool` is permissionless — a pool's params are
fixed at creation forever and no key can alter them.

---

## 4. Settle — resolve pools from proofs

**When:** while/after the match plays. Safe to run repeatedly; it's idempotent (a settled
pool won't re-settle).

```bash
# all five pools, dry-run (default)
npm run settle --workspace services/settler -- --fixture 17588310 --network devnet

# just the corners pool
npm run settle --workspace services/settler -- --fixture 17588310 --pool 1

# pin kickoff explicitly (finished fixtures leave the upcoming snapshot)
npm run settle --workspace services/settler -- --fixture 17588310 --lock-ts 1718900000000

# once the program is deployed: actually submit
npm run settle --workspace services/settler -- --fixture 17588310 --submit
```

Flags: `--fixture <id>` (required), `--network devnet|mainnet`, `--pool <index>` (default:
all), `--lock-ts <unix_ms>` (override kickoff), `--submit` (turn off dry-run; **no-op with a
warning until `EXACT_MATCH_PROGRAM_ID` is set**). Default is **dry-run**.

### What one pass does (`runCrankOnce`)

1. Fetch the scores sequence (`/api/scores/historical` → `/snapshot` → `/updates`) and distil
   `{seq, statusSoccerId}` records.
2. **Refund short-circuit:** if the latest phase is Abandoned (15) / Cancelled (16) /
   Postponed (19), route every pool to a `match_abandoned` refund (README §5.2).
3. Per pool, pick the **settle seq** (`phase.settleSeqFor`):
   - **HT pools** (`settle_phase = 3`): the first `seq` whose record is at HT (3). First-half
     stats (`1001/1002`) are final at the break.
   - **FT pools** (`settle_phase = 5`): only when the match is genuinely over — the latest
     record must be a terminal phase F (5) / FET (10) / FPE (13). A mid-match F followed by
     extra-time records is *not* treated as final.
4. Fetch the proof(s) and build the plan:
   - **COUNT** (`buildSettleCountTx`): one `stat-validation` proof; predicate
     `(a [±b]) EqualTo claimed_actual`, where `claimed_actual` defaults to the proof's observed
     value. If a forged value were passed it would fail on-chain `6021 PredicateFailed` — the
     log flags the mismatch.
   - **WHEN** (`buildSettleWhenTx`): build the cumulative stat series, `pickWhenSeqs` finds the
     bracketing seqs, then **proof A** (`== N-1`, batch before the window) + **proof B**
     (`>= N`, batch inside → the answer bucket), or a single **terminal** proof (`<= N-1`) for
     NEVER (bucket 20). Buckets are 5-minute windows relative to kickoff — *UI shows minutes,
     money settles buckets* (`docs/settlement-spec.md` §3.1).
5. Log the plan: predicate, op, observed stat values, proof-vector lengths (the CU / 1232-byte
   budget, spike #4), the derived `daily_scores_roots` PDA, and the pool PDA/vault. A JSON dump
   follows for scripting.

### Deploy-gated submission

The one missing piece (`TODO(program)` in `settle.ts` / `crank.ts`):

```ts
// COUNT
exactMatchProgram.methods
  .settle(new BN(call.ts), summary, fixtureProof, mainTreeProof, claimedActual)
  .accounts({ pool, vault, dailyScoresMerkleRoots, txoracleProgram, … })
  .rpc();
// WHEN
exactMatchProgram.methods
  .settleWhen(proofA…, proofB…, claimedBucket)   // or (terminalProof…, NEVER)
  .accounts({ pool, vault, dailyScoresMerkleRoots, txoracleProgram, … })
  .rpc();
```

Our program rebuilds the predicate from `claimed_actual` and CPIs `txoracle::validate_stat`
with the already-assembled `call.args`, passing the read-only `daily_scores_roots` PDA. The
bytes/CU are known from the plan's `proofSizes`. Two WHEN proofs may exceed one tx's budget —
spike #4 decides one-tx vs a store-A-then-settle-B two-step (`docs/settlement-spec.md` §3).

---

## 5. The crank loop (unattended)

`crank.ts` exposes `runCrank(opts)` — poll `runCrankOnce` every `intervalMs` (default 30s)
until every pool resolves, `maxPasses` is hit, or `stop()` is called. This is the shape a
long-running bot or a replay-driven demo uses; the `settle` CLI runs a single pass. Because
the crank is permissionless and stateless (it derives everything from on-chain roots + TxLINE
proofs), you can run N of them in parallel with no coordination — the first valid `settle`
wins and the rest no-op.

---

## 6. Refunds — when a match never settles

Two independent refund triggers (README §5.2), both permissionless, no proof required:

1. **Match abandoned/cancelled/postponed** — detected from the phase (15/16/19). The crank
   routes every pool to `refund` immediately.
2. **Settle deadline passed** — `now > lock_ts + 12h` and the pool is still Open (proofs never
   became available, match postponed off-feed, etc.). Any entrant can trigger it.

`buildRefundTx` produces the `RefundPlan` (reason, `settle_deadline_ts`, eligibility). Once
deployed it submits per-entrant as
`exactMatchProgram.methods.refund().accounts({ pool, vault, entrant, … }).rpc()`, returning each
stake. `refund()` enforces `now > settle_deadline_ts` on-chain — the off-chain eligibility check
is a convenience, not the gate.

---

## 7. Quick reference

```bash
# 0. one-time: get a TxLINE token (blocked on funding today)
npm run auth -- --network devnet

# 1. before kickoff: print the pool set for a fixture
npm run bootstrap --workspace services/settler -- --fixture <id> --network devnet

# 2. during/after the match: dry-run settle (fetch proofs, build+print the tx)
npm run settle --workspace services/settler -- --fixture <id> --network devnet

# 3. after the program is deployed (EXACT_MATCH_PROGRAM_ID set): submit
npm run settle --workspace services/settler -- --fixture <id> --submit

# typecheck the settler
npx tsc -p services/settler/tsconfig.json --noEmit
```

**No token** → auth hint + clean exit (bootstrap still prints with a placeholder kickoff).
**No `EXACT_MATCH_PROGRAM_ID`** → dry-run plan only, everywhere. **No admin key, ever** — the
whole point.
