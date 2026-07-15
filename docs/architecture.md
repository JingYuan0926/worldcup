# Exact Match — Architecture

Precision prediction pools for the 2026 World Cup, settled trustlessly by TxLINE Merkle
proofs on Solana. This doc is the map: components, data flow, repo layout, and the **actual**
build status as of 2026-07-09. Product spec and payout math live in `README.md` (the single
source of truth); settlement mechanics in `docs/settlement-spec.md`.

## 1. System diagram

```
                        ┌──────────────────────────────────────────────┐
                        │  TxLINE (TxODDS)                             │
                        │  REST + SSE (scores, odds, fixtures)         │
                        │  Merkle proofs anchored on Solana (txoracle) │
                        └───────┬──────────────────────┬───────────────┘
                                │ SSE / REST           │ stat-validation proofs
                                v                      v
┌──────────────┐    ws    ┌───────────┐        ┌──────────────┐   settle tx   ┌─────────────────────┐
│  Next.js web │ <──────  │  ingest   │        │  settler     │ ────────────> │ exact-match program │
│  (timeline/  │          │  service  │        │  crank bot   │               │ (Anchor, devnet)    │
│   slider UI) │          │ +recorder │        │(permissionl.)│               │  - pool PDAs        │
└──────┬───────┘          │ +replayer │        └──────────────┘               │  - USDT-2022 vault  │
       │ enter/claim txs  └───────────┘                                       │  - CPI validate_stat│
       v                                                                      └─────────┬───────────┘
   Solana devnet  <──────────────────────────────────────────── CPI ──────────────────┘
                                                          txoracle (6pW64…yP2J devnet)
```

Four components, buildable in parallel (README §4):

| # | Component | Stack | Job | Status |
|---|-----------|-------|-----|--------|
| 1 | `program/` | Anchor (Rust) | Pool escrow + proof-verified settlement. **No admin key.** | **Not started** (deferred to last; toolchain now installed) |
| 2 | `services/ingest/` | TypeScript (Node) | TxLINE auth, SSE consumption, **raw-frame recorder + replayer**, ws fan-out. | **Partial** — auth + recorder built; replayer/fan-out pending |
| 3 | `services/settler/` | TypeScript (Node) | Watch phase; on HT/FT fetch `stat-validation` proof, build + send `settle`. Permissionless. | **Scaffold only** (package.json) |
| 4 | `web/` | Next.js + wallet-adapter | Timeline canvas, slider entry, watch phase, settlement receipt + proof viewer. | **Scaffold only** (package.json) |

The shared **payout math** (`packages/payout/`) is a fifth, cross-cutting piece: one
integer-only implementation reused by the web UI preview, the settler, and — mirrored in
Rust — the program, all gated by one test-vector file so they can never drift.

## 2. Data flow

### 2.1 Live / replay ingestion (SSE → web)

```
TxLINE /api/scores/stream ──SSE(gzip)──> SseClient ──> RecorderSession ──> recordings/<net>/<fixtureId>/scores.ndjson
   (or /api/odds/stream)                     │                                      │
                                             │                              (replayer re-emits, Phase 0 remaining)
                                             v                                      v
                                    [normalized event bus] ───ws fan-out──> Next.js watch phase
                                        (Phase 2, pending)                    (stat ticker, sweeping clock)
```

- **Recorder (built).** `RecorderSession`/`StreamRecorder` open the scores (and optionally
  odds) SSE streams with gzip, write each frame verbatim as an ndjson envelope
  (`{recvMs, recvIso, id, event, data}`) to `recordings/<network>/<fixtureId>/`, persist a
  `.cursor` (`Last-Event-ID`) for lossless resume, and emit a `meta.json`. Recorded frames
  are the ground-truth replay data for the whole demo (README §4: build the recorder first).
- **Replayer (pending).** Re-emit recorded frames at 1x/20x/60x **behind the same interface
  as live**, so the web app and settler cannot tell live from replay. CLI entrypoint
  `src/cli/replay.ts` is wired in `package.json` (`npm run replay`) but not yet implemented.
- **Fan-out (pending, Phase 2).** A normalized event bus (goals/corners/cards per team,
  phase, clock derived from the Scores JSON) pushed over websocket to the web app.

### 2.2 Settlement (proof → program → txoracle)

```
settler watches phase ──HT(3)/F(5)/FET(10)/FPE(13)──> find settle seq
   ──> GET /api/scores/stat-validation?fixtureId=&seq=&statKey=&statKey2=
   ──> build settle / settle_when tx (predicate + StatTerms + daily_scores_roots PDA)
   ──> exact-match program.settle(...)  ──CPI──>  txoracle.validate_stat(...) -> bool
   ──> require(true); actual = claimed; state = Settled
   ──> claim(): recompute §5.3 payout from entries+actual, transfer from vault
```

Mechanics, the two-proof WHEN bracketing, the 5-minute bucket model, and the
provisional phase-binding rule are specified in **`docs/settlement-spec.md`**. Path A (CPI
into `validate_stat`) is the primary target; Path B (self-verify the roots PDA) is the
fallback; Path C (off-chain) is last resort.

### 2.3 Auth (one-time per network)

`authenticate()` runs the README §7.2 flow: guest JWT → on-chain `txoracle.subscribe(level,
weeks)` (creates the user's TxL Token-2022 ATA idempotently first) → ed25519-sign
`${txSig}::${jwt}` → `POST /api/token/activate` → apiToken. Tokens persist to `.tokens/<net>.json`.
Every data request thereafter carries **both** headers: `Authorization: Bearer <jwt>` and
`X-Api-Token: <apiToken>` (README gotcha #1). The app authenticates on **devnet level 1**;
the live recorder on **mainnet level 12** (real-time, free). **Never mix networks.**

> **Current blocker:** `.tokens/` is empty — the devnet `subscribe` tx is unfunded, so no
> data-fetching script can run yet. Every such script is written to detect missing tokens
> (`TxlineClient.fromSaved` throws) and exit cleanly with a "run `npm run auth --
> --network <net>` first" message, so it is correct and ready the moment tokens exist.

## 3. Repo layout (README §12)

```
program/            # Anchor workspace (exact_match + txoracle CPI interface)   — NOT YET CREATED
services/ingest/    # auth, SSE client, recorder, replayer, ws fan-out
services/settler/   # phase watcher + proof fetcher + settle/refund crank       — scaffold only
web/                # Next.js app                                               — scaffold only
packages/payout/    # shared deterministic payout math (TS; mirrored in Rust)
docs/               # settlement-spec.md, architecture.md, txline-feedback.md, TASKS.md, payout-vectors.json
recordings/         # captured SSE frames (raw gitignored; one sample kept for CI replay)
keypairs/           # devnet.json / mainnet.json wallet keypairs (gitignored)
```

### 3.1 Files that exist today (`services/ingest/src/`)

| File | Exports / role |
|---|---|
| `config.ts` | `loadConfig(networkOverride?)` → `RuntimeConfig` (network, RPC, keypair, service level, dirs); loads repo-root `.env`. |
| `record.ts` | `RecorderSession`, `RecordOptions` — the SSE raw-frame recorder. |
| `cli/auth.ts` | `npm run auth` entrypoint — runs the auth flow, persists tokens. |
| `cli/record.ts` | `npm run record` entrypoint — starts a `RecorderSession` for a fixture. |
| `sse/reader.ts` | `SseClient`, `SseMessage`, `SseOptions` — resilient gzip SSE with backoff + `Last-Event-ID` resume. |
| `txline/client.ts` | `TxlineClient` (both-header REST client, 401 JWT refresh), `guestStart`, `TxlineError`. |
| `txline/auth.ts` | `authenticate()` — full guest→subscribe→activate flow (spike #1). |
| `txline/networks.ts` | `getNetwork`, `NETWORKS`, `NetworkName`, `TxlineNetwork`, `PRICING_MATRIX_SEED`, `TOKEN_TREASURY_V2_SEED`. |
| `txline/idl.ts` | `loadTxoracleIdl(network)` — loads the Anchor 0.31 new-format IDL, overrides `address` per cluster. |
| `txline/idl/txoracle.{devnet,mainnet}.json` | Vendored txoracle IDL (program `txoracle` v1.4.2). |
| `util/log.ts` | `logger(scope)` — scoped console logger. |
| `util/tokens.ts` | `TxlineTokens`, `loadTokens`, `saveTokens` — persisted credentials per network. |
| `util/wallet.ts` | keypair loading helper. |

**Wired in `package.json` but not yet implemented** (Phase 0 remaining): `cli/replay.ts`,
`cli/probe.ts` (wire-format probes → `docs/wire-notes.md`), `cli/proof-roundtrip.ts` (spike
#2 `.view()`), `cli/backfill.ts` (`/api/scores/historical` for replay fixtures).

### 3.2 `packages/payout/`

- `src/index.ts` — `computePayouts`, `acc`, `medianError`, `ACC_SCALE`, `NEVER_BUCKET`, and
  the `EntryInput`/`EntryResult`/`PayoutResult` types. Integer-only; BigInt for the
  overflow-prone `losers_pot × weight` product (Rust must use `u128`).
- `test/payout.test.ts` — vitest suite driven by `docs/payout-vectors.json`.
- `docs/payout-vectors.json` — the shared drift guard; the Rust program's `cargo test` uses
  the same file. The web UI imports `@exact-match/payout` for its live payout preview.

## 4. Key conventions & constraints

- **Monorepo:** npm workspaces (`packages/*`, `services/ingest`, `services/settler`, `web`).
  TypeScript strict everywhere; ESM + NodeNext (relative imports carry the `.js` extension).
- **Tokens are Token-2022:** devnet USDT (escrow) and TxL (subscription) mints are
  Token-2022 — `token_interface` in Anchor, `TOKEN_2022_PROGRAM_ID` in TS.
- **No admin key** on any program instruction; no fee switch. Headline feature — grep-able.
- **Payout parity:** one algorithm, two implementations (TS + Rust), one test-vector file.
- **Secrets:** `.env` (never committed) holds keypair paths + per-network config; `.tokens/`
  and raw `recordings/` are gitignored (one sample recording kept for CI replay).

## 5. Build status snapshot (2026-07-09)

- **Done:** repo scaffold, TxLINE auth module + CLI, SSE recorder + CLI, shared payout math
  + test vectors, this docs set.
- **In progress / next (Phase 0):** replayer, wire-format probe, proof round-trip `.view()`
  spike, historical backfill — all gated on running `auth` to mint TxLINE tokens.
- **Pending (Phase 1+):** Anchor program source (accounts, create/enter/settle/settle_when/
  claim/refund) + Rust payout port; ingest fan-out; settler crank + pool bootstrapper; the
  full web app (timeline canvas, watch phase, settlement receipt/proof viewer).
- **Deferred to last (user directive):** on-chain program build/deploy + the CPI go/no-go
  test (spike #3) — toolchain (`anchor 0.31.1`, `solana 2.1.0`) is installed and ready.
