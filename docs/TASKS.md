# Execution checklist

Tick items as completed. Phase order matters; within a phase, tasks marked ∥ can run in parallel. README section references in parentheses.

## Phase 0 — Data lifeline + de-risking (do NOW; no Solana CLI needed)

- [ ] Repo scaffold: npm workspaces, tsconfig, .env.example, .gitignore (recordings/, .env, keypairs)
- [ ] TxLINE auth module (`services/ingest/src/auth.ts`): guest JWT → devnet `subscribe(1, 4)` via web3.js/anchor → sign `${txSig}::${jwt}` → activate → persist tokens (§7.2; spike #1)
- [ ] Same flow on mainnet with service level 12 (real-time, free) for the recorder key
- [ ] **Recorder** (`services/ingest/src/record.ts`): scores + odds SSE with gzip, raw frames to `recordings/<fixtureId>/`, auto-reconnect with Last-Event-ID — **run on tonight's QF (18209181) and every remaining match** (spike #9)
- [ ] Backfill: `scores/historical` for 2–3 finished WC fixtures as replay test data
- [ ] ∥ Wire-format probe script → `docs/wire-notes.md`: statusSoccerId shape, `stats` map keys, proof hash encoding, odds Prices scaling, WC competitionId (spikes #7, #8)
- [ ] ∥ Proof round-trip (spike #2): fetch stat-validation proof for a finished fixture → `validateStat(...).view()` against devnet txoracle → record: does devnet anchor real WC fixtures? CU consumed (spike #4)? `EqualTo`+`Add` semantics confirmed (spike #5)?
- [ ] ∥ Phase-settlement rule investigation (spike #6) → write `docs/settlement-spec.md` draft
- [ ] Replayer (`services/ingest/src/replay.ts`): re-emit recorded frames at 1x/20x/60x behind the same interface as live
- [ ] GO/NO-GO note in `docs/settlement-spec.md`: Path A (CPI) vs Path B (self-verify) — final call needs spike #3 (blocked on toolchain; note assumptions and proceed with Path A as design target)

## Phase 1 — Payout math + program source (source only; build/deploy deferred)

- [ ] Shared test vectors `docs/payout-vectors.json`: normal case, all-tie, single entry, median edges (odd/even), crowded guess, NEVER cases, max entries (§5.3)
- [ ] TS payout function (`web/src/lib/payout.ts`) passing all vectors
- [ ] Anchor program source (§6): Pool/Entry accounts, create_pool, enter, settle (COUNT), settle_when (WHEN), claim, refund — Rust payout function passing the same vectors (unit tests compile with `cargo test`, no Solana toolchain needed for pure-math tests)
- [ ] txoracle CPI interface module generated from the published devnet IDL
- [ ] ASK USER: install Solana + Anchor toolchain → build, `anchor test` (bankrun/local-validator), spike #3 CPI test, deploy to devnet

## Phase 2 — Services

- [ ] Ingest fan-out: normalized event bus (live SSE or replay) → websocket for the web app; stat ticker derivation (goals/corners/cards per team, phase, clock)
- [ ] Settler crank (`services/settler/`): watch phase transitions (HT=3, F=5/FET=10/FPE=13) → find settle `seq` → fetch stat-validation proof(s) → build settle / settle_when tx → submit; refund path after deadline; runbook in `docs/` (permissionless — anyone can run it)
- [ ] Pool bootstrapper: create pools for upcoming fixtures from `/api/fixtures/snapshot` (curated templates §5.1)
- [ ] End-to-end rehearsal on replayed match: pools → entries (test wallets) → auto-settle → claims (blocked on deploy)

## Phase 3 — Web app

- [ ] Scaffold: Next.js + Tailwind + wallet-adapter; devnet USDT faucet button (txoracle `request_devnet_faucet`)
- [ ] Match list page: fixtures, countdowns, pool summaries
- [ ] **Timeline canvas** (hero, §5.4): 0–90' + NEVER zone, drag markers snapping to 5-min buckets, crowd heat strip per pool, payout preview, stake + lock countdown; COUNT sliders with histogram below
- [ ] Watch phase: sweeping clock, live ticker via ingest websocket, true-event pins, actual-value needle
- [ ] Settlement receipt + Merkle proof viewer (raw proof JSON, root PDA, explorer link, verify-yourself walkthrough)
- [ ] Crowd Forecast panel (§5.4 4b)
- [ ] Precision Score leaderboard (off-chain, display only)
- [ ] Judges' replay room: deployed page running a recorded match on the replayer with a pre-funded pool

## Phase 4 — Demo + submission (Jul 16–18)

- [ ] Record semifinals live (Jul 14, 15) — b-roll + fresh replay data
- [ ] Demo video ≤5 min (script beats in README §2 + planning history): problem → timeline entry → live watch → halftime settlement on-chain → **forged-proof robbery fails on camera** → receipt/verify → judges' pool CTA
- [ ] `docs/`: settlement-spec.md final, architecture.md, txline-feedback.md (required), demo-script.md
- [ ] Deploy web app publicly; fund the judges' pool
- [ ] Renounce program upgrade authority (on camera); final repo cleanup; submit on Superteam Earn (Jul 18 — not deadline day)
