# Exact Match

**Precision prediction pools for the 2026 World Cup that settle themselves — closest guess wins, no admin key, no oracle, no human. Escrow and settlement run on Solana; the truth comes from TxLINE (TxODDS) cryptographic Merkle proofs.**

📄 **Full technical documentation → [`TECHNICAL.md`](./TECHNICAL.md)** · Solana **devnet** · data by **TxLINE**

---

## What it is

Today almost every prediction market is **binary** — yes/no, over/under — which flattens skill into a coin flip and pays the crowd, not the sharp caller. **Trepa** introduced *precision* markets to reward the good players instead: predict an exact value, and the most accurate players win the most. **Exact Match applies that same principle** to live World Cup football — call the exact number or the exact minute, and the pot flows to whoever was closest, not to whoever got a yes/no right. Real fans make sharper calls (how many corners, which minute the goal comes); this market rewards them for it.

It also fixes the other weakness of prediction markets: they normally lean on a human to decide the truth — an oracle, a vote, or an admin holding the funds — so settlement is slow and trust‑based. Exact Match settles **trustlessly** from TxLINE cryptographic proofs, with no admin key:

- Pools open before a match — *"Total corners in France vs Morocco?"* / *"Which 5‑minute window is Argentina's 1st goal?"* You stake devnet USDC on an exact number or time, and the pool **locks at kickoff**.
- During play, the live TxLINE SSE feed drives the UI.
- At the settle phase (half‑ or full‑time), a **permissionless** crank fetches TxLINE's Merkle proof of the real stat and the pot splits by accuracy. **The program has no admin key — nothing but a valid proof moves the money.** A forged stat is rejected on‑chain (`6023 InvalidStatProof` / `6021 PredicateFailed`).

Payout is an accuracy‑weighted parimutuel: winners (error ≤ the median error) get their stake back plus a share of the losers' pot weighted by `stake × accuracy`, computed once at claim time with deterministic integer math — see [payout math](./TECHNICAL.md#accuracy-weighted-payout-calculation).

## Markets

Technically there is **one pool type** — the two‑lane timeline **WHEN pool** — and **COUNT is integrated inside it**, not a separate market. On‑chain it is a single generic `Pool` ([`lib.rs`](./program/programs/exact-match/src/lib.rs)): a numeric range where you stake on an integer guess and the pot flows to whoever is closest to the settled value.

- **WHEN / the timeline (the market).** Predict *which 5‑minute window* a team's Nth goal lands in. Each team's Nth goal is its own pool — *Argentina's 1st goal*, *2nd goal*, *Switzerland's 1st goal*, … — so a marker on a lane is at once **which ball** (the ordinal) and **at what minute** (the window). The guess is a 5‑minute bucket index (0–18, or `NEVER` = 20) — which is itself a count, so counting is baked in.
- **COUNT, integrated.** The very same pool answers a plain *quantity* question when the guess is read as a raw number instead of a time bucket — e.g. the in‑play Flash pool *"how many minutes is the match a draw?"*. Same account, same `enter → settle → claim` flow, same payout function — no separate pool type.

Every pool is **independent**: its own escrow vault and its own liquidity (pot), seeded per `(fixture_id, pool_index)`, so *Argentina's 1st goal* holds a separate pot from *Argentina's 2nd goal*. The accuracy‑weighted payout is computed **on‑chain** ([`payout.rs`](./program/programs/exact-match/src/payout.rs)) and mirrored byte‑for‑byte by the TypeScript `@exact-match/payout` package against a shared vector file. Full taxonomy: [Market types](./TECHNICAL.md#market-types).

## Architecture

```
        TxLINE (TxODDS): REST + SSE (scores, odds, fixtures)
        Merkle proofs anchored on Solana (txoracle program)
                 │ SSE / REST              │ stat-validation proofs
                 ▼                         ▼
  ┌─────────────┐   read/write    ┌───────────┐     ┌───────────────┐  settle  ┌──────────────────────┐
  │ Next.js web │ ──────────────► │  ingest   │     │   settler     │ ───────► │ exact_match program  │
  │ (timeline)  │                 │ +recorder │     │ crank (perm.) │          │ (Anchor, devnet)     │
  └─────────────┘                 └───────────┘     └───────────────┘          └──────────────────────┘
       │ enter / claim (wallet)                                                 CPI → txoracle::validate_stat
       ▼
   Solana devnet
```

| Component | Stack | Job |
|---|---|---|
| `program/` | Anchor (Rust) | Pool escrow + settlement. No admin key. Deployed on devnet (`9KKWfU1…`). |
| `services/ingest/` | TypeScript | TxLINE auth, SSE consumption, raw‑frame **recorder + replayer**, one‑second materializer, websocket fan‑out. |
| `services/settler/` | TypeScript | Permissionless crank: watches match phase, fetches the proof, builds the settle tx. |
| `packages/payout/` | TypeScript | The shared accuracy‑weighted payout function (mirrored in the Rust program). |
| Next.js app (repo root: `pages/` `components/` `lib/` `styles/`) | Next 16 / React 19 / wallet‑adapter | Markets grid, the two‑lane timeline canvas, live watch phase, settlement receipt. |

## How settlement stays trustless

`settle` verifies TxLINE's Merkle proof of the real stat by CPI into TxLINE's on‑chain `txoracle::validate_stat`, against the `daily_scores_merkle_roots` PDA — a forged value fails on‑chain. COUNT pools settle with one exact‑value proof (`EqualTo`, plus `Add`/`Subtract` for two‑team stats); WHEN pools use two bracketing 5‑minute proofs. Full instruction/account spec: [Solana / Merkle‑proof settlement](./TECHNICAL.md#solana--merkle-proof-settlement).

> **Current state (honest):** the deployed devnet program's `settle` is **resolver‑signed** (the operator key) as a placeholder; swapping the resolver check for the `validate_stat` CPI is the remaining delta to the "no admin key" goal, and the settler already builds that proof plan. See [Current limitations](./TECHNICAL.md#current-limitations).

## TxLINE integration

TxLINE is the primary data source. The full endpoint set and the auth flow are in [TxLINE endpoints and SSE feeds](./TECHNICAL.md#txline-endpoints-and-sse-feeds); the endpoints used:

| Purpose | Endpoint |
|---|---|
| Fixture list | `GET /api/fixtures/snapshot?startEpochDay=&competitionId=` |
| Live scores (SSE) | `GET /api/scores/stream?fixtureId=` |
| Live odds (SSE) | `GET /api/odds/stream?fixtureId=` |
| Poll / snapshot fallback | `GET /api/scores/updates/{fixtureId}` · `GET /api/scores/snapshot/{fixtureId}` |
| Full match replay | `GET /api/scores/historical/{fixtureId}` |
| Settlement proofs | `GET /api/scores/stat-validation?fixtureId=&seq=&statKey=&statKey2=` (or `&statKeys=`) |

Networks: devnet `https://txline-dev.txodds.com` (txoracle `6pW64…`) and mainnet `https://txline.txodds.com` (txoracle `9Exb…`) — never mixed. Every data request carries **both** headers: `Authorization: Bearer <jwt>` **and** `X-Api-Token: <token>`; auth is a guest JWT → on‑chain `subscribe` tx → activated API token. API friction notes are logged in [`docs/txline-feedback.md`](./docs/txline-feedback.md).

Captured devnet feeds live in [`recordings/`](./recordings) — raw scores/odds `.ndjson` plus a materialized one‑second timeline per fixture — and drive the replay used by the UI and tests.

## Repository layout

```
pages/  components/  lib/  styles/  public/   # Next.js app (Pages Router) at repo root
packages/payout/                              # shared accuracy-weighted payout math (@exact-match/payout)
services/ingest/                              # TxLINE auth, SSE recorder + replayer, materializer, ws fan-out
services/settler/                             # permissionless phase-watcher + proof-fetcher + settle/refund crank
program/                                      # exact_match Anchor program (deployed on devnet)
recordings/                                   # captured TxLINE devnet feeds (+ one sample fixture)
docs/                                         # settlement-spec, txline-feedback, architecture, demo-script, …
TECHNICAL.md                                  # full technical documentation
```

## Local development

Requires Node ≥ 22 and a `.env` (copy `.env.example`). Full setup + the env‑var table are in [Local setup and environment variables](./TECHNICAL.md#local-setup-and-environment-variables).

```bash
npm install
npm run dev            # Next.js app → http://localhost:3000

# backend / data CLIs (proxied to services/ingest)
npm run auth                                                 # TxLINE guest JWT → subscribe → API token
npm run record -- --fixture <id> --network devnet --odds    # record live SSE frames
npm run auto-record                                         # supervisor: arm capture before kickoff, materialize, backfill
npm run replay -- --fixture <id>                            # replay a recorded match
```

## Status & limitations

- **Devnet only** — play‑money USDC (a classic SPL 6‑decimal demo mint); no real‑money wagering. Framed as skill‑based precision forecasting; the TxLINE credit token is never touched by this program.
- **Program deployed on devnet** (`9KKWfU1EB51EmBoiTusZ3J7h7b6JmHNa2aQujtJdZBen`); `settle` is currently resolver‑signed, with the `validate_stat` CPI as the trustless target.
- **The dense per‑second crowd histogram is a simulated presentation overlay** — pool pots, entries, bets and claims are real on‑chain transactions.
- Full detail and honest gaps: [TECHNICAL.md → Current limitations](./TECHNICAL.md#current-limitations).

---

**📄 Full technical documentation: [`TECHNICAL.md`](./TECHNICAL.md)**
