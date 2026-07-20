# ExactMatch — Technical Documentation

ExactMatch turns a single 2026 World Cup fixture into a set of independent, precision prediction pools that settle trustlessly from TxLINE data on Solana. Each pool escrows its own pot in one Anchor program and resolves from a TxLINE Merkle proof rather than a trusted reporter, with **no admin key** moving the money. The app runs on Solana devnet with play-money USDC; the on-chain program is already deployed.

## Contents

- [How ExactMatch works](#how-exactmatch-works)
- [Market types](#market-types)
- [TxLINE endpoints and SSE feeds](#txline-endpoints-and-sse-feeds)
- [Second-by-second recording and replay](#second-by-second-recording-and-replay)
- [Accuracy-weighted payout calculation](#accuracy-weighted-payout-calculation)
- [Solana / Merkle-proof settlement](#solana--merkle-proof-settlement)
- [Local setup and environment variables](#local-setup-and-environment-variables)
- [Current limitations](#current-limitations)

## How ExactMatch works

ExactMatch turns one football fixture into a set of independent, precision prediction pools that settle trustlessly from TxLINE data. The signature screen is the **two-lane exact-time timeline** (README §5.4): a horizontal `0–124'` match ruler with a **home lane on top and an away lane on the bottom**, each ending in the country's flag. In the demo fixture (`18222446`) the lanes are Argentina (home) and Switzerland (away). `MATCH_SECONDS = 124 * 60`.

Before kickoff you "paint the match before it happens": pick an event tool (goal / yellow / red / corner), click a lane, then drag a marker horizontally to its exact `MM:SS` or vertically to switch teams. You may place any number of markers. **Only goal markers are stakeable** — corners and cards are drawn so the lane shows the full match shape, but placing one is display-only and never becomes a pool call (`lib/pools.ts`, `components/MatchScreen.tsx`). After kickoff the same canvas flips to live mode: the match clock sweeps across everyone's markers, real events pin to their true time, and the flash market drops in.

**Exact seconds off-chain, 5-minute buckets on-chain.** The UI keeps each goal marker's exact second, but the money settles on a coarser grid: on-chain roots are posted per **5-minute batch** (`BUCKET_SECONDS = 5 * 60`, 300s), so a goal call resolves to the 5-minute *bucket* it lands in, not the exact minute. Buckets `0–17` cover regulation (0–90'), bucket `18` (`MAX_REAL_BUCKET`) absorbs everything past 90' including stoppage and extra time, and bucket index **20 is `NEVER`** — the outcome "this goal never happened." (There is no bucket 19 in use; 20 is reserved for NEVER so a NEVER call has an error-distance from any real bucket.) `bucketOf(second) = Math.min(18, Math.floor(second / 300))`. A hydrated on-chain marker is drawn at the *midpoint* of its settled bucket, because the exact second only ever lived in the browser.

## Market types

Two pool kinds share one program and one median-error payout rule (README §5.1). Every pool is independent — own pot, own proof, own settlement — and a wallet's match winnings are the sum over the pools it entered. `ALL_POOL_INDEXES = [0,1,2,3,4,5,6]` (six goal pools + one flash pool). The only two pool kinds are COUNT and WHEN.

### Pre-match: goal-window WHEN pools (`GOAL_POOLS`, pool indexes 0–5)

These are **WHEN pools**: "in which 5-minute window does this team's Nth goal land?" Placing the Nth goal marker on a lane *is* your entry in that lane's Nth-goal pool — one entry per wallet per pool, no separate input flow. There are six (`lib/pools.ts`):

| poolIndex | Lane | Ordinal | Label | statKey |
|---|---|---|---|---|
| 0 | home (ARG) | 1st | ARG 1st goal | 1 |
| 1 | home (ARG) | 2nd | ARG 2nd goal | 1 |
| 2 | home (ARG) | 3rd | ARG 3rd goal | 1 |
| 3 | home (ARG) | 4th | ARG 4th goal | 1 |
| 4 | away (SUI) | 1st | SUI 1st goal | 2 |
| 5 | away (SUI) | 2nd | SUI 2nd goal | 2 |

`statKey 1` is participant-1 (home) goals, `statKey 2` is participant-2 (away) goals. Pools run one ordinal past each team's real count (ARG scored 3, SUI scored 1) so that betting on a goal that never comes is a live outcome — it settles to `NEVER` (bucket 20), not an impossible one. On-chain these pools store a **bucket index** (0–18, or 20 for NEVER); the winning distance is measured in buckets. They settle trustlessly with two bracketing 5-minute proofs (README §5.1).

### In-play: the FLASH market (`FLASH_POOL`, pool index 6)

The FLASH market is a **COUNT pool**, not a WHEN pool. Its question is **"How many minutes will this match be a draw?"** (`min 0`, `max 124`). It is presented in `components/FlashMarket.tsx` as a slider on the match clock and **settles on the exact minute, not on a 5-minute bucket** — so its on-chain value holds a raw minute count (0–124) rather than a bucket index. It drops mid-broadcast at **20'** (`FLASH_DROP_SECOND = 20 * 60`), and in the demo the drop pulls replay speed down to 1× so the room can read and call before it locks.

The outcome is computed by `minutesDrawn(...)`: walk the goal timeline and sum every stretch where the scores are level, **including 0–0 from kickoff** and any draw still standing at full time. For the demo fixture (0–0 until 9:35, then 1–1 from 66:50 to 111:42) that is **54 minutes**.

**Honest caveat (from the code's own comment):** this market *fails* the "Provable" gate in README §5.1, which only admits a template that settles from ≤2 on-chain stat keys. Minutes-drawn cannot — the same 3–1 scoreline is reachable through wildly different tie durations, so it needs the whole goal timeline. Under the resolver it settles fine (the outcome is derived from the recorded feed like every other pool), but it could not become trustless under the current `validate_stat` design without a proof per goal.

### On a "Burst" market

There is **no "Burst" market** — a case-insensitive search for `burst` returns zero matches anywhere in the codebase and in `README.md`. It is neither implemented nor specified; the only two pool kinds are COUNT and WHEN. Any "Burst"-style pool would be a purely future idea, so it is omitted here rather than fabricated.

## TxLINE endpoints and SSE feeds

All TxLINE traffic goes to one of two base hostnames, chosen by network. Never mix them: a devnet `subscribe` tx must be activated on devnet, mainnet on mainnet.

| Network | API/SSE origin | Solana cluster | txoracle program |
|---|---|---|---|
| devnet | `https://txline-dev.txodds.com` | `devnet` | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |
| mainnet | `https://txline.txodds.com` | `mainnet-beta` | `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA` |

Origins are defined in `services/ingest/src/txline/networks.ts`. The app runs on devnet (service level 1, free, real-time); the live recorder uses mainnet level 12 (free, real-time). Both are set as `defaultServiceLevel` in the same file.

### Endpoints used

Paths are appended to the network origin. Every request carries both auth headers.

| Purpose | Method + path | Where it's built |
|---|---|---|
| Scores SSE stream | `GET /api/scores/stream?fixtureId={id}` | `services/ingest/src/record.ts`, `cli/serve.ts` |
| Odds SSE stream | `GET /api/odds/stream?fixtureId={id}` | `services/ingest/src/record.ts` |
| Fixtures snapshot | `GET /api/fixtures/snapshot?startEpochDay=&competitionId=` | `services/settler/src/proofs.ts`, `services/ingest/src/cli/probe.ts` |
| Settlement proof | `GET /api/scores/stat-validation?fixtureId=&seq=&statKey=&statKey2=` (legacy 2-stat) or `&statKeys=` (V2 N-stat) | `statValidationPath()` in `services/settler/src/proofs.ts` |

A concrete recorded example lives in `recordings/devnet/18257739/meta.json`:

- scores: `https://txline-dev.txodds.com/api/scores/stream?fixtureId=18257739`
- odds: `https://txline-dev.txodds.com/api/odds/stream?fixtureId=18257739`

### SSE feed details

The SSE reader (`services/ingest/src/sse/reader.ts`) opens the stream with these request headers, in addition to the two data headers:

- `Accept: text/event-stream`
- `Cache-Control: no-cache`
- `Accept-Encoding: gzip` (optional; ~70–80% smaller, gunzipped streaming)
- `Last-Event-ID: <cursor>` on reconnect, so no frames are lost across drops

Score data messages carry `id = timestamp:index` and `data` = one Scores JSON; keepalives arrive as `event: heartbeat`. The recorder persists the last seen `id` to a cursor file and resumes from it via `Last-Event-ID`.

### Stat validation and the on-chain proof check

`/api/scores/stat-validation` returns the Merkle proof payload; the actual verification is the on-chain txoracle `validate_stat` instruction, run read-only via `.view()` / `simulateTransaction` (no SOL needed). The pipeline:

1. Fetch the proof JSON from `/api/scores/stat-validation?…` (`fetchStatValidation` in `services/settler/src/proofs.ts`).
2. `normalizeStatValidation(...)` in `services/ingest/src/txline/txoracle.ts` parses it into snake_case domain shapes, decoding every hash to exactly 32 bytes (`decodeHash32`, accepts base64/base64url/0x-hex/bare-64-hex).
3. `buildValidateStatArgs(...)` emits the ordered, camelCase wire args spread into `program.methods.validateStat(...)`.

Two gotchas in this module: the API field `eventStatsSubTreeRoot` is renamed to the on-chain `events_sub_tree_root` during normalization, and all field/enum keys handed to Anchor must be camelCase (snake_case keys serialize to a silent zero rather than throwing).

### Auth flow

The four-step flow lives in `services/ingest/src/txline/auth.ts` (`authenticate`) and `client.ts` (`guestStart`):

1. **Guest JWT** — `POST {origin}/auth/guest/start` (no body) → `{ token: <jwt> }`. The JWT has a 30-day expiry; a `401` triggers `refreshJwt()`, which re-runs `guestStart` and retries once.
2. **On-chain subscribe** — the user wallet signs and pays for `txoracle.subscribe(serviceLevel, weeks)`. Free tiers charge 0 TxL but the tx is still required. Returns `txSig`.
3. **Sign activation message** — ed25519-detached sign of `` `${txSig}:${leagues.join(",")}:${jwt}` `` (empty leagues → `` `${txSig}::${jwt}` ``), base64-encoded.
4. **Activate** — `POST {origin}/api/token/activate` with body `{txSig, walletSignature, leagues}` and header `Authorization: Bearer <jwt>` → the `apiToken` as text/plain (surrounding quotes stripped).

### Required headers on every data request

`TxlineClient.dataHeaders()` in `services/ingest/src/txline/client.ts` attaches both headers to every REST call and to the SSE stream — both are mandatory:

- `Authorization: Bearer <jwt>`
- `X-Api-Token: <apiToken>`

## Second-by-second recording and replay

ExactMatch settles on what actually happened, so the ingest service treats the TxLINE feed as irreplaceable ground truth: it captures raw SSE frames verbatim, then derives everything else (the one-second timeline, the UI, the settlement plan) deterministically. Four CLIs cover the lifecycle — `record`, `auto-record`, `materialize`, and `replay` — all under `services/ingest`.

### The SSE recorder

`npm run record` opens the TxLINE `scores` stream (and, with `--odds`, the `odds` stream) for one fixture and appends every frame to an ndjson file, one JSON envelope per line:

```json
{"recvMs":1784486728570,"recvIso":"2026-07-19T...Z","id":"1784486728569:0","event":"message","data":"{...verbatim SSE payload...}"}
```

`data` is the exact SSE payload string — never re-parsed at capture time — so a recording is a faithful transcript of the wire. Files land under `recordings/<network>/<fixtureId>/`: `scores.ndjson`, optionally `odds.ndjson`, plus a `meta.json`. Both streams are opened in append mode, so a restart never truncates prior data.

Resilience comes from two mechanisms in the SSE client (`services/ingest/src/sse/reader.ts`):

- **gzip + auto-reconnect.** The stream is requested with `Accept-Encoding: gzip` and gunzipped inline; dropped connections reconnect with exponential backoff and jitter (1000ms → 30000ms cap).
- **Resumable cursors via `Last-Event-ID`.** Each frame carries an SSE `id` (`timestamp:index` for TxLINE scores). The recorder writes the latest id to a sibling `<stream>.cursor` file on every frame. On (re)connect — including across a full process restart — it reads that cursor and sends it as the `Last-Event-ID` header, so TxLINE resumes exactly where capture left off.

```bash
# mainnet capture of scores + odds
npm run record -- --fixture 18209181 --network mainnet --odds

# devnet, scores only (network defaults to devnet)
npm run record -- --fixture 18209181
```

`--fixture` is required (or set `WC_QF_FIXTURE_ID`); `--network` defaults to `devnet`; `--odds` adds the second stream. Ctrl-C flushes and closes the files cleanly.

### The auto-record supervisor

`npm run auto-record` is a long-running daemon that captures fixtures without babysitting. Each poll (default every 30s) it fetches TxLINE's fixture snapshot for the competition (default World Cup, id 72) and plans each fixture through a state machine: **armed → recording → draining → awaiting-backfill → finalizing → complete**.

- **Arms capture before kickoff.** For every fixture it computes `recordAtMs = startTime − lead` (default lead 10 minutes). While `now < recordAtMs` the fixture sits `armed`; once the window opens it flips to `recording` and spawns the same `record` CLI (with `--odds`) plus a `materialize --allow-partial --watch` child, so a live one-second timeline refreshes during play. Capturing before the whistle guarantees the opening seconds are never missing.
- **Drains final corrections.** When the manifest shows a terminal phase, the fixture enters `draining` and keeps recording for a grace window (default 120s) to catch late stat corrections, then stops the live children.
- **Backfills to strict completeness.** After a delay (default 6h post-kickoff) it requests TxLINE's historical replay into `historical.ndjson`, re-materializes in strict mode, and only marks the fixture `complete` when the manifest proves full kickoff-to-terminal coverage. If backfill isn't ready, it retries (default every 15 minutes).

State persists to `recordings/<network>/auto-capture-state.json` and a PID lock (`auto-capture.lock`) prevents two daemons from colliding; on restart it resumes each fixture from its saved stage.

```bash
# run the supervisor against devnet
npm run auto-record -- --network devnet

# print the computed fixture plan and exit (no capture)
npm run auto-record -- --network devnet --once

# tune the timing windows
npm run auto-record -- --network mainnet --lead-minutes 15 --drain-seconds 180 --poll-seconds 20
```

Flags (all optional): `--network`, `--poll-seconds` (30), `--lookahead-hours` (24), `--lead-minutes` (10), `--drain-seconds` (120), `--retry-minutes` (15), `--historical-delay-hours` (6), `--competition-id` (72), and `--once`/`--dry-run`.

### Materialization: one deterministic row per second

The raw ndjson is a stream of *sparse action frames* at irregular times — TxLINE only emits a frame when something changes. `npm run materialize` collapses that into a dense **`timeline-1s.ndjson`**: exactly one row per second from kickoff to the terminal phase, which is what the UI scrubs and the tests assert against.

1. **Read + canonicalize.** Load `scores.ndjson` (live) and, if present, `historical.ndjson` (corrected post-match), skip heartbeats, de-duplicate by per-fixture `seq`. On overlap, corrected historical frames win over live, otherwise the later receive wins — recorded as `duplicatesRemoved`.
2. **Fold field-wise.** `foldReplayState` applies each frame as a patch: only fields present on a frame replace prior values (nested `Clock` and `Stats` included), so explicit zeroes stay authoritative while absent fields are preserved.
3. **LOCF.** Walking second-by-second, every frame whose `ts` falls in `[fromTsMs, toTsMsExclusive)` is folded into the running state; a second with no new frame re-emits the prior state. Each row is tagged `fill: "observed"`, `"forward-filled"`, or `"unknown"` (before the first frame — only in partial recordings).

```json
{"schemaVersion":1,"fixtureId":18257739,"second":1,"fromTsMs":1784487600000,
 "toTsMsExclusive":1784487601000,"fill":"observed","state":{...folded state...},
 "updates":[{"seq":13,"tsMs":...,"source":"live","action":"...","payload":{...}}]}
```

Alongside it, **`timeline-1s.manifest.json`** records provenance and whether the recording is trustworthy for settlement:

- `totalSeconds` — one-second rows, `ceil((endTs − kickoff)/1000)`; the sample is 10923.
- `terminalPhase` — the game phase at the end (terminal set `{5, 10, 13, 15, 16, 19}` = FT / FT-after-ET / FT-after-pens / abandoned / cancelled / penalties); `null` if never terminal.
- `unknownSeconds` — opening seconds with no data (`firstObservedSecond − 1`); 0 means capture started at or before kickoff.
- `complete` — `true` only when `unknownSeconds === 0` **and** a terminal phase was seen. This is the go/no-go flag the supervisor waits on.

Also included: `kickoffTsMs`, `endTsMs`, `canonicalFrames`, `duplicatesRemoved`, and `sources`/`output` paths. (Sample: `totalSeconds 10923`, `terminalPhase 10`, `unknownSeconds 0`, `complete true`, `canonicalFrames 1374`, `duplicatesRemoved 0`.)

By default materialize is **strict**: if the recording is missing opening seconds or never reached a terminal phase it throws, forcing a historical backfill before the data is used for money. `--allow-partial` relaxes this for live previews, and `--watch` re-runs the build every 10s against the growing file (an atomic temp-file rename keeps readers from seeing a half-written timeline).

```bash
# strict build of the settlement-grade timeline (workspace script — not proxied at repo root)
npm run materialize --workspace services/ingest -- --fixture 18257739 --network devnet

# live preview while the match is still recording
npm run materialize --workspace services/ingest -- --fixture 18257739 --network devnet --allow-partial --watch
```

### Replay for the UI and tests

`npm run replay` re-emits a recorded ndjson file behind the **same interface as the live feed** — the `Replayer` delivers each frame as an `SseMessage` via an `onMessage` callback and as `'message'` EventEmitter events — so the ingest fan-out, the websocket clients, and CI tests consume replay and live streams identically. This drives the demo video and deterministic replay tests without TxLINE credentials (replay reads local files only).

Inter-frame timing is reconstructed from recorded `recvMs` deltas, divided by `--speed` and clamped to `maxSleepMs` (default 3000ms) so quiet gaps don't stall fast playback. Heartbeats are skipped unless `--heartbeats` is passed; `--loop` restarts at end-of-file. The input path defaults to `recordings/<network>/<fixtureId>/<stream>.ndjson` and falls back to the bundled sample fixture so the command always runs.

```bash
# 20× real-time replay of a recorded match
npm run replay -- --fixture 18209181 --network mainnet --speed 20

# 60× scores-only replay
npm run replay -- --fixture 18209181 --network mainnet --speed 60 --stream scores

# loop a specific file forever (Ctrl-C to stop)
npm run replay -- --file recordings/mainnet/18209181/scores.ndjson --loop
```

Flags: `--fixture`/`--file`, `--network` (defaults `mainnet`), `--stream` (`scores`), `--speed` (1), `--loop`, `--heartbeats`.

## Accuracy-weighted payout calculation

Every pool settles with one deterministic, **integer-only** median-error rule (README §5.3). It is written once in TypeScript (`packages/payout/src/index.ts`) and mirrored exactly in the Anchor program's Rust, both validated against the shared vectors in `docs/payout-vectors.json` so the UI preview, the settler, and the on-chain `claim()` can never drift.

### The formula (exact, integer division throughout)

```
error_i    = |guess_i - actual|
median_e   = median of all errors     (even count → the LOWER of the two
                                        middle values, i.e. index n/2 - 1)
winners    = { i : error_i <= median_e }   // ties at the median win (<=)
losers     = everyone else

ACC(e)     = 1_000_000 / (1 + e*e)     // integer division; ACC(0)=1_000_000,
                                        // ACC(1)=500_000, ACC(2)=200_000, ACC(3)=100_000
weight_i   = stake_i * ACC(error_i)    // winners only; losers weight 0
losers_pot = Σ stake_j for j in losers

payout_i (winner) = stake_i + floor(losers_pot * weight_i / Σ weights_winners)
payout_j (loser)  = 0
```

The accuracy weight `ACC(e) = 1_000_000 / (1 + e²)` is deliberately steep so exactness dominates on small integer ranges. Each winner gets their **stake back plus a share of the pooled losers' stakes**, split in proportion to `stake × ACC(error)`.

### Key properties

- **Exact + lonely pays the most.** Payout scales with `accuracy × how uncrowded your guess is`. In the `crowded-vs-lone-exact` vector (actual = 2), the lone exact entrant turns a 5,000,000 stake into 9,545,454 (~1.91×) while each crowd member (off by 2, staking 10,000,000) receives 11,818,181 (~1.18×), the loser (guess 9) gets 0, and dust is 3.
- **Solo entrant gets their stake back.** A lone entrant is trivially at/below the median, so they refund exactly (`single-entry` vector).
- **Everyone same error → all refund.** If all errors are equal (including all-exact), everyone wins, `losers_pot = 0`, and each entry refunds its stake.
- **Rounding dust stays in the vault.** Floor division leaves at most a few base units (`dust = vault − totalPayout`); there is **no protocol fee** in v1, reinforcing the no-admin-key story. Invariant: `totalPayout <= vault`, `dust >= 0`.

### WHEN pools reuse the same function

WHEN pools pass 5-minute **bucket indices** (0–17 regulation, 18 = stoppage/beyond, `NEVER_BUCKET = 20`) as both `guess` and `actual`. `|guess − actual|` then encodes the "NEVER vs bucket b = 20 − b" rule automatically, so one payout function serves both COUNT and WHEN pools.

### Function signature and I/O

The single entry point is **`computePayouts(entries, actual)`** in `packages/payout/src/index.ts`:

```ts
function computePayouts(entries: EntryInput[], actual: number): PayoutResult

interface EntryInput  { guess: number; stake: bigint }        // stake in token base units
interface EntryResult { guess; stake; error; isWinner; weight; payout }
interface PayoutResult {
  actual: number; medianError: number;
  losersPot: bigint; totalWeight: bigint;
  vault: bigint; totalPayout: bigint; dust: bigint;
  entries: EntryResult[];
}
```

Supporting pure functions in the same module: `acc(error: number): bigint` and `medianError(errors: number[]): number`. Constants: `ACC_SCALE = 1_000_000n` and `NEVER_BUCKET = 20`.

### Overflow discipline (why BigInt / u128)

With USDC (6 decimals) a single winner weight can reach ~1e14, and the intermediate product `losers_pot * weight_i` can reach ~6.4e23 — which overflows **both** u64 and JavaScript's safe-integer range (~9.0e15). TypeScript uses `BigInt`; the Rust mirror **must** use `u128` for that product. Final payouts fit comfortably in u64.

## Solana / Merkle-proof settlement

ExactMatch escrows every pool in a single Anchor program and resolves it from a TxLINE Merkle proof rather than a trusted reporter. This section documents what is actually on devnet today and the one remaining delta to full trustlessness.

### The `exact_match` Anchor program

- **Program id:** `9KKWfU1EB51EmBoiTusZ3J7h7b6JmHNa2aQujtJdZBen` — `declare_id!` in `program/programs/exact-match/src/lib.rs` and the `"address"` field of `lib/idl/exact_match.json`. **Deployed on devnet.** IDL metadata: `name exact_match`, `version 0.1.0`, `spec 0.1.0`.
- **Five instructions** (real names from the IDL — the pool-creation instruction is `create_pool`, not `initialize`):

  | Instruction | Signer | What it does |
  |---|---|---|
  | `create_pool(fixture_id, pool_index, stat_key_a, stat_key_b, op, lock_ts, settle_phase, slider_min, slider_max, resolver)` | any `payer` | Permissionless. Inits the pool PDA + vault ATA, freezes params forever. Sets `settle_deadline_ts = lock_ts + 12h`. Validates `slider_min < slider_max`, span ≤ `MAX_SLIDER_SPAN` (200), `op ≤ 1`, `stat_key_a != 0`. |
  | `enter(guess, stake)` | `user` | One entry per wallet, before `lock_ts`, while `Open`. `guess` within `[slider_min, slider_max]`; `stake` in `[1_000_000, 100_000_000]` base units (1–100 USDC); `< MAX_ENTRIES` (64). `transfer_checked` into the vault. |
  | `settle(claimed_actual: i32)` | `resolver` | Flips `Open → Settled` once, records `actual = claimed_actual` (the stat total for COUNT or the 5-minute bucket index for WHEN, `NEVER = 20`). Requires `now >= lock_ts` and `claimed_actual` within range. **The one gated instruction.** |
  | `claim()` | `user` | Requires `Settled`. Recomputes the entrant's payout from `entries + actual` via `payout_for` every time (nothing stored at settle), pays from the vault signed by the pool PDA, marks `claimed`. |
  | `refund()` | `user` | Permissionless escape hatch. Requires state `!= Settled` and `now > settle_deadline_ts`. Returns the stake and flips state to `Refunding`. Stops the resolver holding funds hostage by inaction. |

  Note: README §6 specs proof-carrying settle instructions — `settle(target_ts, fixture_summary, fixture_proof, main_tree_proof, claimed_actual)` and a separate `settle_when(proof_a, proof_b, claimed_bucket)`. The **deployed IDL exposes only `settle(claimed_actual: i32)`**; COUNT and WHEN are folded into that one placeholder pending the CPI wire-up.

### Pool PDAs and the vault

- **Pool PDA seeds:** `[b"pool", fixture_id.to_le_bytes() /* i64, 8 bytes LE */, pool_index.to_le_bytes() /* u8, 1 byte */]`. `(fixture_id, pool_index)` deterministically addresses each pool. Mirrored in `services/settler/src/settle.ts::poolPda`.
- **Vault:** an Associated Token Account owned by the pool PDA, created in `create_pool`. The pool records its own `mint` at creation (`has_one = mint`); every `enter`/`claim`/`refund` transfer goes through that vault, signed by the pool PDA seeds.
- The `services/settler` crank pre-computes the curated pools per fixture (`POOL_TEMPLATES` in `phase.ts`, `poolIndex` 0–6).

### Escrow asset: Token-2022 vs classic SPL

- The program uses Anchor's `token_interface` (`InterfaceAccount<Mint/TokenAccount>`, `Interface<TokenInterface>`, `token_interface::transfer_checked`) **throughout**, so a Token-2022 mint or a classic SPL mint both work unchanged — the token program is passed as an account, not hardcoded.
- **The demo uses a classic (Tokenkeg) SPL, 6-decimal USDC mint: `H39LvFdH7Ra1ZbnW9hNxxqfFgZiRfTw2ATff4iGcVHS5`** (default `NEXT_PUBLIC_USDC_MINT`/`USDC_MINT`). Because stakes are a classic 6-dec mint, `MIN_STAKE = 1_000_000` = 1 USDC and `MAX_STAKE = 100_000_000` = 100 USDC.
- The `lib.rs` header corrects a README §7.1 / CLAUDE.md gotcha #3 claim: the devnet USDT mint `ELWTKsp…` is **not** Token-2022 — it is owned by the classic SPL Token program. Going through `token_interface` means the distinction cannot bite the program. (Scaffold caveat: `settle.ts::poolVault` currently derives the vault ATA with `TOKEN_2022_PROGRAM_ID` hardcoded, which must be reconciled to the classic Token program for the `H39Lv` demo mint when the settle path is wired to submit.)

### Settlement on 5-minute buckets (WHEN pools)

TxLINE posts Merkle roots per **5-minute batch**, and a stat leaf carries only the batch's `min/max_timestamp` window — no exact event time. So WHEN pools settle on a **5-minute bucket index**, not a minute: `bucket = floor((batch_min_timestamp_ms - lock_ts_ms) / 300_000)` (`bucketFromTimestamp` in `proofs.ts`; `BUCKET_MS = 300_000`). There are 18 regulation windows (`0…17`), `18 = BEYOND_BUCKET` (stoppage/extra time), `19` a deliberate gap, and `20 = NEVER_BUCKET`. A WHEN pool is bracketed by two proofs — proof A `stat == N-1` on a batch before the crossing, proof B `stat >= N` inside the crossing batch — or a single terminal proof `stat <= N-1` for NEVER. The UI shows minutes; money settles buckets (CLAUDE.md gotcha #5).

### Trustless verification: the `validate_stat` CPI

The design target (Path A) is that `settle` **CPIs into TxLINE's on-chain `txoracle` program** (`validate_stat`), passing the read-only `daily_scores_merkle_roots` PDA, and requires the returned bool `== true`. The settler already builds the exact CPI args (`services/settler/src/settle.ts::buildValidateCall` → `buildValidateStatArgs`): a `TraderPredicate {threshold, comparison}` (`EqualTo` for COUNT; `EqualTo`/`GreaterThan`/`LessThan` for WHEN brackets), `stat_a` (+ optional `stat_b`, `op = Add` for two-key pools), and the fixture/main-tree/stat proof vectors.

- **Forged stats are rejected on-chain by `txoracle`, not by us.** A tampered value fails with **`6023 InvalidStatProof`** (bad stat leaf) or **`6021 PredicateFailed`** (real value ≠ claimed); related txoracle codes are `6003 InvalidSubTreeProof`, `6004 InvalidMainTreeProof`, `6007 RootNotAvailable`, `6013 InvalidTimeSlot`. This is the demo centerpiece — "the market that cannot cheat."
- **Root PDA:** `[b"daily_scores_roots", epochDay.to_le_bytes() /* u16 LE, 2 bytes */]` under the `txoracle` program id, with `epochDay = floor(summary.update_stats.min_timestamp_ms / 86_400_000)` taken from the proof's own timestamp (`dailyScoresRootsPda` / `epochDayFromTs`).
- Field rename to watch (gotcha #4): the API's `eventStatsSubTreeRoot` is the on-chain `events_sub_tree_root`; proof hashes arrive base64 or `0x`-hex and must decode to exactly 32 bytes.

### "No admin key on any instruction" — the headline, and the current gap

The product headline (README, CLAUDE.md gotcha #7) is that **nothing but a valid proof moves the money**: no admin key, no oracle vote, no fee switch. `create_pool`, `enter`, `claim`, and `refund` are all permissionless with no privileged signer. Be exact about the current state, though: the **deployed** `settle` is gated by a `resolver` `Signer` (`Settle` accounts: `resolver` + `pool`, `constraint = pool.resolver == resolver.key()` → error `6015 NotResolver`). This is a **deliberate, temporary trust delta** and the *only* authority in the program — a placeholder for the not-yet-verified `validate_stat` CPI. The resolver cannot touch the vault, take a fee, refund, claim, or re-settle (`Open → Settled` flips exactly once), cannot settle before lock or outside the pool's range, and if it never settles, `refund` opens to everyone at the deadline. Replacing the resolver check with the `validate_stat` CPI is the whole remaining delta to the trustless design — no account layout, payout math, or client code changes with it (`buildSettleCountTx`/`buildSettleWhenTx` are marked `TODO(program)` for exactly this swap).

### The permissionless settler crank

`services/settler/src/crank.ts` (`runCrankOnce`/`runCrank`) is the off-chain driver — **anyone can run it; there is no admin key.** Per pass it fetches the fixture's Scores records, classifies the game phase, and per pool decides `settle_ready` / `refund` / `pending`:

- **HT pools** (`settle_phase = 3`) settle at the first `seq` whose `statusSoccerId == 3`; **FT pools** (`settle_phase = 5`) settle only when the last record is terminal — `F (5)`, `FET (10)`, or `FPE (13)` (`settleSeqFor` / `FT_TERMINAL_PHASES`).
- Abandoned/cancelled/postponed (`15/16/19`) route to **refund**; otherwise a deadline refund fires once `now > lock_ts + 12h`.
- For each settle-ready pool it fetches the `stat-validation` proof(s) at the chosen `seq`, builds the plan + the `validate_stat` CPI args, and logs them. Actual submission is deploy-gated behind `EXACT_MATCH_PROGRAM_ID` (`exactMatchProgramId()`), so the full proof→settle path is verifiable before the CPI lands.

The program's own Anchor errors are namespaced separately from txoracle's (both start at 6000): `6000 InvalidRange`, `6001 InvalidStatSpec`, `6002 PoolNotOpen`, `6003 PoolLocked`, `6004 GuessOutOfRange`, `6005 StakeOutOfRange`, `6006 PoolFull`, `6007 AlreadyEntered`, `6008 AlreadySettled`, `6009 NotYetLocked`, `6010 ActualOutOfRange`, `6011 NotSettled`, `6012 NotAnEntrant`, `6013 AlreadyClaimed`, `6014 DeadlineNotPassed`, `6015 NotResolver`, `6016 WrongMint`, `6017 VaultUnderflow`, `6018 MathOverflow`. (So `exact_match` has no 6023 — `6023 InvalidStatProof` belongs to `txoracle`.)

## Local setup and environment variables

### Prerequisites

- **Node.js >= 22** (enforced by the root `package.json` `engines` field) and npm.
- **No Solana CLI / Anchor toolchain is required for local development.** The `exact_match` program is already deployed to Solana devnet; the app and services talk to it over RPC using the embedded IDL. (Rebuilding/redeploying the program *does* need the toolchain — see Current limitations.)

### Repository layout

The repo is an npm-workspaces monorepo whose **root is itself the Next.js 16 web app**. The workspaces are `packages/*`, `services/ingest`, and `services/settler`:

```
/ (root)              # Next.js 16 app — pages/, components/, lib/, styles/, public/
  packages/payout/    # @exact-match/payout — shared integer-only payout math (transpiled by Next)
  services/ingest/    # @exact-match/ingest — TxLINE auth, SSE recorder, replayer, ws fan-out (CLIs)
  services/settler/   # settle/refund crank — builds the settle tx, dry-run until submitted
  lib/                # chain client (lib/chain.ts), demo orchestration (lib/demo-ops.ts), crowd sim
  pages/              # Pages Router: index, /match, /mint, and /api/* (mint faucet + demo reset/seed/settle)
```

`next.config.ts` sets `transpilePackages: ["@exact-match/payout"]` because that workspace ships raw TypeScript and is imported by the bet/flash/settlement panels; without it the `/match` route fails to compile.

### Install and run

```bash
npm install                # installs all workspaces from the repo root
cp .env.example .env        # then fill in values (never commit .env)

npm run dev                 # start the web app (next dev) at http://localhost:3000
npm run build               # production build
npm run start               # serve the production build
npm run lint                # eslint
npm test                    # runs `npm test` across workspaces (if present)
npm run typecheck           # tsc --noEmit across workspaces
```

### Backend CLIs

These root scripts delegate into `services/ingest` (each runs a `tsx` entrypoint under `services/ingest/src/cli/`). Pass CLI flags after `--`; most default to `--network devnet` (overridable via `TXLINE_NETWORK`).

| Command | Runs | What it does |
|---|---|---|
| `npm run auth` | `cli/auth.ts` | TxLINE authentication flow; persists JWT + API token to `TXLINE_TOKENS_DIR` (`.tokens/<network>.json`). Loads/creates the wallet at `DEVNET_WALLET_KEYPAIR`. Supports `-- --network mainnet` and `-- --verify`. |
| `npm run record` | `cli/record.ts` | Records raw TxLINE SSE frames for a fixture into `recordings/`. |
| `npm run auto-record` | `cli/auto-record.ts` | Plans upcoming fixtures and captures their frames automatically. |
| `npm run replay` | `cli/replay.ts` | Replays recorded frames (one-second cadence) to drive the web timeline. |

The `services/ingest` workspace also exposes `serve`, `materialize`, `probe`, `proof-roundtrip`, and `backfill` scripts for lower-level work.

### Environment variables

Copy `.env.example` to `.env`. The first block below is shipped in `.env.example`; the second block is read by the web app / API routes and is not in the example file (each has a code default, so the app boots without them, but you will want to set them for a real deployment). `.env`, `keypairs/`, and `.tokens/` are all gitignored.

| Variable | Scope | Purpose | Default |
|---|---|---|---|
| `TXLINE_NETWORK` | services | Which TxLINE network to target for **data**: `devnet` or `mainnet`. | `devnet` |
| `SOLANA_DEVNET_RPC` | server | Solana devnet RPC endpoint. Used by the mint faucet and demo-ops. | `https://api.devnet.solana.com` |
| `SOLANA_MAINNET_RPC` | server | Solana mainnet RPC endpoint. | `https://api.mainnet-beta.solana.com` |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | browser | RPC used by the in-browser wallet provider / `lib/chain.ts`. | `https://api.devnet.solana.com` |
| `DEVNET_WALLET_KEYPAIR` | server | Path to the keypair that signs the on-chain `subscribe` tx (and app txs). Created by `npm run auth` if absent. Doubles as demo mint authority and pool resolver. | `./keypairs/devnet.json` |
| `MAINNET_WALLET_KEYPAIR` | server | Path to the mainnet keypair JSON (must be funded for mainnet auth). | `./keypairs/mainnet.json` |
| `DEVNET_SERVICE_LEVEL` | services | `subscribe()` service level on devnet (free, 0s delay). | `1` |
| `MAINNET_SERVICE_LEVEL` | services | `subscribe()` service level on mainnet (free, real-time). | `12` |
| `SUBSCRIBE_WEEKS` | services | `subscribe()` weeks argument; must be a multiple of 4. | `4` |
| `TXLINE_TOKENS_DIR` | services | Directory where the auth module writes persisted TxLINE tokens per network (gitignored). | `./.tokens` |
| `WC_QF_FIXTURE_ID` | services | Known World Cup quarterfinal fixtureId (recording/replay convenience). | `18209181` |
| `NEXT_PUBLIC_USDC_MINT` | browser | Demo USDC mint address the browser derives ATAs from (`lib/chain.ts`). | `H39LvFdH7Ra1ZbnW9hNxxqfFgZiRfTw2ATff4iGcVHS5` |
| `USDC_MINT` | server | Demo USDC mint used server-side by the faucet and demo-ops; falls back to `NEXT_PUBLIC_USDC_MINT`, then the built-in default. | (falls back to `NEXT_PUBLIC_USDC_MINT`) |
| `NEXT_PUBLIC_FIXTURE_ID` | browser | On-chain pool **namespace** fixtureId used by the browser and `/api/demo/state`. Pool PDAs are seeded by `(fixture_id, pool_index)`, so changing this moves the pools to a fresh namespace. | `18222446` (client) / `18222447` (demo state route) |
| `FIXTURE_ID` | server | Non-`NEXT_PUBLIC_` server-side fallback (`lib/chain.ts` reads `FIXTURE_ID` after the public var). | code default |
| `EXACT_MATCH_PROGRAM_ID` | services | Program id the **settler** uses to build/submit the settle tx (`services/settler/src/settle.ts`). Returns `null` (dry-run plan only) when unset. The web app instead reads the program id from the embedded IDL `address`. | unset |

## Current limitations

- **The Anchor / Solana CLI toolchain is not installed, so the on-chain program is not rebuilt or redeployed from this machine.** The `exact_match` program is nonetheless **already deployed on devnet** (program id `9KKWfU1EB51EmBoiTusZ3J7h7b6JmHNa2aQujtJdZBen`, read from `lib/idl/exact_match.json`), and the web app and services interact with that deployed program via its embedded IDL. What is blocked is `anchor build`/`deploy` and the CPI test program (README day-1 spike #3); installing the toolchain is deferred until program work is required.

- **The dense per-second crowd histogram under the timeline is simulated presentation data.** `lib/crowdSim.ts` generates a deterministic synthetic per-second crowd used to draw the timeline candles, and the demo's seed step (`lib/demo-ops.ts`) populates each pool with roughly 28 synthetic crowd wallets so the shape reads well on camera. The **staking itself is still on-chain**: pot sizes and entry counts shown on the pool cards are read from real on-chain `Pool` accounts (`fetchPools` in `lib/chain.ts`), so bets are genuine devnet transactions — only the fine-grained per-second distribution overlay is synthetic.

- **The mint faucet and one-click demo API routes require a server-side operator keypair that is not committed.** `pages/api/mint.ts` (the test-USDC faucet) and `pages/api/demo/*` (reset → seed → settle, via `lib/demo-ops.ts`) read `keypairs/devnet.json` — which is the mint authority *and* the pool resolver. That directory is gitignored, so a plain clone or deploy without the keypair present will make these routes fail. They are also deliberately open and devnet-only; the module must never run against a cluster where that key controls anything real.

- **Settlement is currently resolver-signed, not yet proof-verified on-chain.** The deployed devnet program's `settle` instruction takes a `resolver` **signer** plus a `claimed_actual` argument, and the `Pool` account carries a `resolver` field — so today a pool is settled by the resolver key (the same devnet operator keypair), not by cryptographic verification. The intended trustless path is a CPI into TxLINE's `txoracle::validate_stat` (README §6, "Path A"), driven permissionlessly by `services/settler`; the settler already builds and logs that plan (dry-run by default until `--submit`), but the deployed program does not yet enforce proof verification, and the TxLINE `subscribe`/token funding needed for live proofs is currently blocked. This is an honest trust delta relative to the "no admin key" headline goal.

- **Devnet only.** The app runs on Solana devnet (TxLINE service level 1), and all demo funds are play-money devnet USDC from the faucet. Nothing here is intended for mainnet.
