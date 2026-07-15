# Exact Match

**Precision prediction pools for the 2026 World Cup that settle themselves — closest guess wins, no admin key, no oracle, no human. Settled on Solana by TxLINE cryptographic proofs.**

> Hackathon build spec. Written 2026-07-09 for the TxODDS World Cup Hackathon on Superteam Earn.
> Track: **Prediction Markets & Settlement** (18k USDT pool). Submissions close **July 19, 2026, 23:59 UTC**.
> Every TxLINE fact in this document was verified against the live docs on 2026-07-09. Anything uncertain is listed in [Day-1 spikes](#day-1-spikes-do-these-first) — do those before building on the assumption.

---

## 1. Problem

1. **Prediction markets depend on humans to decide the truth.** An oracle, a voting process (Polymarket → UMA), or an admin holding funds. Settlement is slow (hours+), disputable, and trust-based.
2. **Yes/no betting is a coin flip.** Real football fans make sharper calls — how many corners, what minute the goal comes. Binary markets don't reward precision, and listing exact-value outcomes as bundles of binary markets fragments liquidity into dead order books.

## 2. Solution

Trepa-style **precision pools** (predict an exact number with a slider, accuracy-weighted parimutuel payout) applied to live World Cup matches, with **trustless settlement**:

- Pools open before a match: *"Total corners in France vs Morocco?"* Slide to your number, stake devnet USDT. **Pool locks at kickoff** (Trepa's model: predict → lock → watch → win; no in-play sniping possible).
- Watch phase: the live TxLINE SSE feed drives the UI while the match plays.
- The moment the settle phase is reached (halftime or full-time), a permissionless crank fetches TxLINE's Merkle proof of the real stat and submits it. The program verifies the proof against TxLINE's on-chain Merkle root and the pot splits by accuracy. **The program has no admin key. Nothing but a valid proof can move the money.**

Payout model (adapted from Trepa's documented mechanics): winners = entries with error ≤ median error; winners get their stake back plus a share of the losers' stakes weighted by `accuracy_weight × stake`. Deterministic integer math, spec in §6.

**Demo centerpiece:** on camera, try to settle a pool with a forged stat value — the chain rejects it (error 6023 `InvalidStatProof` / 6021 `PredicateFailed`). Then the real proof lands and the pot splits. "The market that cannot cheat."

---

## 3. Hackathon requirements (must all be true at submission)

- Deployed working build (devnet is fine), **not** a mockup — mockups are auto-disqualified.
- **Demo video ≤ 5 minutes** (judges see no live matches at review time — the video is the product; also ship a judge-testable artifact: a pre-funded pool on devnet they can settle themselves).
- Public GitHub repo.
- Working deployed link (web app) or functional devnet endpoint.
- Brief technical doc: core idea + list of TxLINE endpoints used.
- Written feedback on the TxLINE API (what we liked, where we hit friction) — **collect friction notes as you build**, in `docs/txline-feedback.md`.
- Team ≤ 3 people. Must use TxLINE as primary data source.
- Judging criteria: (a) smooth ingestion of live/simulated TxLINE feeds, (b) intuitive UX / compelling scenario, (c) clean, well-documented, **deterministic** resolution & validation code. The listing explicitly says custom validation logic built on TxLINE's Merkle proofs "will be highly valued by the judges."

---

## 4. Architecture

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
│  (slider UI) │          │  service  │        │  crank bot   │               │ (Anchor, devnet)    │
└──────┬───────┘          │ +recorder │        └──────────────┘               │  - pool PDAs        │
       │ enter/claim txs  └───────────┘                                       │  - USDT vault       │
       v                                                                      │  - CPI validate_stat│
   Solana devnet  <───────────────────────────────────────────────────────────┴──> txoracle program │
                                                                               (6pW64...yP2J)        │
                                                                              └─────────────────────┘
```

Four components, buildable in parallel:

| # | Component | Stack | Job |
|---|-----------|-------|-----|
| 1 | `program/` | Anchor (Rust) | Pool escrow + proof-verified settlement. No admin key. |
| 2 | `services/ingest/` | TypeScript (Node) | TxLINE auth, SSE consumption, **raw-frame recorder + replayer**, fan-out over websocket to the web app. |
| 3 | `services/settler/` | TypeScript (Node) | Watches match phase; on HT/FT fetches `/api/scores/stat-validation` proof, builds + sends `settle` tx. Anyone can run it (permissionless). |
| 4 | `web/` | Next.js + wallet-adapter | Pool cards, slider entry, live watch phase, settlement receipt with proof viewer. |

**Build the recorder first** (day 1). The SSE payload schema has gaps in the docs; recorded frames from a real match are the ground truth for everything else, and the replayer powers the demo video. A quarterfinal (France–Morocco, fixtureId `18209181`) plays **July 9, 20:00 UTC** — record it.

---

## 5. Product spec

### 5.1 Pool types (v1 — build in this order)

Two pool kinds share one program and one payout rule. **COUNT pools** ask "how many?" (slider). **WHEN pools** ask "in which 5-minute window does the Nth event happen?" (marker on the match timeline, §5.4). Every pool is independent: own pot, own proof, own settlement — a user's match winnings are the sum over pools entered. Never combine events into one composite score (a composite creates a prediction↔event matching ambiguity that has no deterministic resolution).

**Market gates — a pool template may be added ONLY if it passes all three.** (1) *Provable*: settles from on-chain stat keys (goals/yellows/reds/corners, per team, per period) with ≤2 stats. (2) *Precision*: the answer is a number or a time — never yes/no. (3) *Primitive*: enterable with the existing slider or timeline marker — no new input flows. Permanently excluded (each fails a gate): player props / first scorer (not in on-chain stat keys), possession & shots (same), BTTS / odd-even / clean sheet (binary), composites & parlays ("2 goals AND a red card" — matching ambiguity + new UI). Note that many traditional time markets are already projections of the timeline: "2 goals by minute X" IS the 2nd-goal marker — do not build them as separate markets.

| Priority | Pool | Kind | Stat keys (see §7.4) | Settles at phase | Range |
|----------|------|------|----------------------|------------------|-------|
| P0 | Total match goals | COUNT | `1 + 2` (Add) | F (5) / FET (10) / FPE (13) | 0–10 |
| P0 | **Winning margin** (one slider covers match-winner AND handicap: +2 = home by 2, 0 = draw, -1 = away by 1; a shootout-decided knockout settles on the goal margin, typically 0 — document this) | COUNT | `1 − 2` (Subtract; threshold i32 may be negative) | F / FET / FPE | -5–+5 |
| P0 | Total match corners | COUNT | `7 + 8` (Add) | F / FET / FPE | 0–25 |
| P0 | **First-half goals** (settles at halftime, mid-broadcast — the flash-pool demo moment) | COUNT | `1001 + 1002` (Add) | HT (3) | 0–6 |
| P1 | **Halftime-break pools**: H2 goals / H2 corners — `lock_ts = kickoff + 50min` (H2 never starts before +60, so entries close during the break; entrants share the same public H1 info — the second play window per match, state the fairness rationale in the UI) | COUNT | `2001 + 2002` / `2007 + 2008` (Add) | F / FET / FPE | 0–6 / 0–15 |
| P1 | **Window of the 1st goal** | WHEN | `1 + 2` (Add), bracketing proofs | F / FET / FPE | 18×5-min buckets + NEVER |
| P1 | Window of the 2nd goal | WHEN | `1 + 2` (Add), bracketing | F / FET / FPE | 18 buckets + NEVER |
| P1 | Window of the 1st yellow card | WHEN | `3 + 4` (Add), bracketing | F / FET / FPE | 18 buckets + NEVER |
| P1 | **Window of the 1st corner** | WHEN | `7 + 8` (Add), bracketing | F / FET / FPE | 18 buckets + NEVER |
| P2 (stretch) | Team-lane goals: "window of France's 1st goal" (per-team keys `1` or `2` alone — the two-lane timeline lets users paint the scoreline as individual goals) | WHEN | single stat key, bracketing | F / FET / FPE | 18 buckets + NEVER |
| P2 (stretch) | Red-card long-shot pool (rare event; NEVER-heavy by design — max one per match) | WHEN | `5 + 6` (Add) | F / FET / FPE | 18 buckets + NEVER |

COUNT pools settle with **one exact-value proof**: TxLINE's on-chain `Comparison` enum includes `EqualTo` and `BinaryExpression` includes `Add` — so "P1 corners + P2 corners == 11" is a single `validate_stat` call (stat_a key 7, stat_b key 8, op Add, predicate `{threshold: 11, comparison: EqualTo}`). Verified in the devnet IDL.

WHEN pools settle with **two bracketing proofs** at 5-minute granularity (the honest limit of the on-chain data: roots are posted per 5-min batch, and the stat leaf carries no timestamp — the batch's `min/max_timestamp` window is what's provable):
- Proof A: at a batch ending before window W, `stat == N-1` (EqualTo).
- Proof B: at a batch inside window W, `stat >= N` (GreaterThan N-1 — covers two events landing in one batch).
- The settle instruction requires both proofs' batch timestamps to be consistent (A's window strictly before B's, B's window = claimed answer). Answer = B's 5-min bucket index relative to kickoff. NEVER settles with a single terminal-phase proof: `stat <= N-1` (LessThan N) at the final batch.
- UI may display exact minutes from the live feed, but money settles on buckets — state this plainly in `docs/settlement-spec.md`.
- Bucket count: 18 regulation buckets (0–90') + 1 stoppage/beyond bucket + NEVER. Extra time folds into the beyond bucket in v1 (document it; per-ET buckets are a cut).

Note: the IDL also exposes `validate_stat_v2` with an `NDimensionalStrategy` containing `geometric_targets: [{stat_index, prediction}]` and a `distance_predicate` — i.e. **native on-chain closeness validation**. If the day-1 spike confirms it works via CPI, using it for scoring is the deepest possible integration and worth calling out in the submission. Treat as stretch; the `EqualTo` path is the safe baseline.

### 5.2 Pool lifecycle (Trepa's model, verified from docs.trepa.io)

```
OPEN ──(kickoff = fixture.StartTime)──> LOCKED ──(watch phase: live SSE)──> SETTLEABLE ──(proof verified)──> SETTLED ──> CLAIMED
                                                                              │
                                                        (no valid settle by deadline, or match abandoned) ──> REFUNDABLE
```

- Entries accepted only while `now < lock_ts` (kickoff). This is Trepa's anti-sniping answer: you predict **before** the window, then watch. No in-play entries in v1.
- `settle_deadline_ts = lock_ts + 12h`. If not settled by then (proofs unavailable, match postponed), anyone can trigger refunds. Phases A (15) / C (16) / P (19) via proof also → refund.
- One entry per wallet per pool. Stake: 1–100 devnet USDT (Trepa uses $1–5 stakes; keep minimums small).

### 5.3 Payout math (deterministic, integer-only)

Adapted from Trepa's documented "median-error rule" + "accuracy weight × stake":

```
error_i  = |guess_i - actual|
median_e = median of all errors (even count: lower of the two middle values)
winners  = { i : error_i <= median_e }
losers   = everyone else

weight_i (winners only) = stake_i * ACC(error_i)
ACC(e)   = 1_000_000 / (1 + e*e)        // integer division; steep so exactness matters on small ranges

losers_pot = Σ stake_j for j in losers
payout_i   = stake_i + floor(losers_pot * weight_i / Σ weights)   // winners
payout_j   = 0                                                     // losers
```

Edge cases (must be unit-tested):
- All entries same error → everyone is a winner → everyone gets exactly their stake back.
- Single entry → refund.
- Rounding dust (from floor division) stays in the vault; acceptable and documented. No protocol fee in v1 — "no fee switch" strengthens the no-admin story.
- Ties at the median: `<=` includes them (crowded guesses split their weight share automatically because each holds the same `ACC`).

Why this survives discrete data: payouts scale with `accuracy × how uncrowded your guess is` — everyone piling on "2 goals" shares a big weight pool thinly; a lone exact call takes most of the losers' pot. Skill = be right where the crowd is wrong.

WHEN-pool errors use the same formula with `guess`/`actual` as **bucket indices** (0–18). NEVER is bucket index 20: a NEVER guess against a NEVER outcome is error 0; NEVER vs bucket `b` is error `20 - b` (late guesses are less wrong than early ones when the event never comes). Same median rule, same weights — one payout function for both pool kinds, unit-tested once.

Off-chain only: a per-user **Precision Score** (Trepa-style, 100–1000) averaging normalized accuracy across all pools entered, for the leaderboard. Display/bragging layer — never touches money or the program.

### 5.4 UI spec (Trepa-inspired; their documented elements: slider, stake-before-close, watch phase, precision score)

1. **Match page** — upcoming fixtures from `/api/fixtures/snapshot`, countdown to kickoff/lock per pool.
2. **Entry — the timeline canvas (the product's signature screen).** The match page is one sparse, full-screen horizontal 0–120' time ruler. Its top toolbar uses real SVG football, corner, yellow-card, and red-card controls (no emoji). Selecting a tool lets the user place **any number** of that event: click the upper France lane or lower Morocco lane, then drag a marker horizontally for its exact `MM:SS` or vertically to change team. Each lane carries the country's real flag at the right edge. The selected marker projects a bright caret through the ruler and has `−1s` / `+1s`, keyboard adjustment, and removal controls. Zoom is continuous from 1×–8×; it widens the same ruler and never changes a marker's stored second. The UI retains exact-second placement off-chain and separately derives the immutable 5-minute settlement bucket, so visual precision never misrepresents on-chain proof granularity. "Paint the match before it happens."
3. **Watch phase** — after kickoff the canvas flips to live mode: the match clock sweeps across the timeline toward everyone's markers while the real-time stat ticker (goals/corners/cards) runs off the SSE stream via the ingest websocket; when an event lands, the true-time marker pins to the timeline and the nearest predictions light up. COUNT pools show the **live actual-value needle** crawling across the crowd histogram. This is the screen the demo video lingers on.
4. **Settlement receipt** — when settled: needle lands on the actual value, winner markers light up, animated payout split, and a **proof receipt panel**: the raw Merkle proof JSON, the on-chain root PDA, a Solana Explorer link to the settle tx, and a "verify yourself" expander that walks the proof levels. This panel is judging-criteria gold — make it beautiful.
4b. **Crowd Forecast panel** (cheap, high judging value) — per match, one chart showing the implied crowd distribution from pool entries ("crowd expects 9–11 corners, 1st goal most likely 20–25'") next to TxLINE consensus odds where available. Turns the app into a data *producer*, not just a consumer — feeds the "compelling scenario" criterion and the sponsor's data-company instincts.
5. **Wallet** — standard wallet-adapter (Phantom). Devnet USDT balance + a "get test USDT" button wired to the txoracle `request_devnet_faucet` instruction (verified to exist in the devnet IDL: mints devnet USDT to the caller's ATA).

---

## 6. Anchor program spec (`program/`)

**No admin authority on any instruction. No fee switch. This is a headline feature — grep-able in the demo.**

Token note: devnet USDT mint `ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh` is **Token-2022** — use `anchor_spl::token_interface` (`InterfaceAccount<Mint>`, `TokenInterface`) everywhere, not the classic `Token` program types.

### Accounts

```rust
// PDA seeds: ["pool", fixture_id.to_le_bytes(), pool_index (u8)]
pub struct Pool {
    pub fixture_id: i64,
    pub pool_index: u8,            // which pool template for this fixture
    pub stat_key_a: u32,           // e.g. 7  (P1 corners)
    pub stat_key_b: u32,           // e.g. 8  (P2 corners); 0 = single-stat
    pub op: u8,                    // 0 = none, 1 = Add
    pub lock_ts: i64,              // kickoff (fixture.StartTime, ms → store as seconds)
    pub settle_phase: u8,          // 3 = HT, 5 = F (accepts 10 FET / 13 FPE as terminal for FT pools)
    pub settle_deadline_ts: i64,   // lock_ts + 12h → refunds allowed after
    pub slider_min: i32,
    pub slider_max: i32,
    pub state: u8,                 // 0 Open, 1 Settled, 2 Refunding
    pub actual: i32,               // set on settle
    pub entries: Vec<Entry>,       // bounded: MAX_ENTRIES = 64
    pub vault_bump: u8,
    pub bump: u8,
}
pub struct Entry { pub wallet: Pubkey, pub guess: i32, pub stake: u64, pub claimed: bool } // 45 bytes
```

Vault: ATA of USDT mint owned by the pool PDA.

### Instructions

| Ix | Signer | Logic |
|----|--------|-------|
| `create_pool(fixture_id, pool_index, stat_spec, lock_ts, settle_phase, slider_range)` | anyone (payer) | Permissionless. Validates ranges. Nothing else — pool params are fixed at creation forever. |
| `enter(guess, stake)` | user | Requires `now < lock_ts`, `slider_min <= guess <= slider_max`, entries not full, wallet not already entered. Transfers USDT user→vault. Pushes Entry. |
| `settle(target_ts, fixture_summary, fixture_proof, main_tree_proof, claimed_actual)` | anyone (the crank, but permissionless) | COUNT pools. Requires `now >= lock_ts`, state Open. Builds predicate `{threshold: claimed_actual, comparison: EqualTo}` and stat terms from the passed proof payload, **CPIs `txoracle::validate_stat`** passing the `daily_scores_merkle_roots` PDA (derivation §7.6); requires returned bool == true. Also requires the proof's stat period/keys match the pool's `stat_key_a/b` and — for FT pools — that a game-phase proof or the summary's timestamps satisfy the settle-phase rule (see day-1 spike #6 for the exact mechanism). Sets `actual = claimed_actual`, state = Settled. |
| `settle_when(proof_a…, proof_b…, claimed_bucket)` | anyone | WHEN pools (§5.1). Two CPIs: proof A (`stat == N-1`, batch window strictly before the claimed bucket) and proof B (`stat >= N`, batch window inside the claimed bucket, bucket computed from the batch timestamps relative to `lock_ts`). NEVER variant: single terminal-phase proof `stat <= N-1`. Sets `actual = claimed_bucket`, state = Settled. Two proofs may exceed one tx's CU/size budget → spike #4 decides one-tx vs a two-step commit (store verified proof A hash, then settle with proof B). |
| `claim()` | entrant | Recomputes §5.3 payout deterministically from `entries` + `actual` (no stored payouts), transfers from vault, marks claimed. |
| `refund()` | entrant | Only if `now > settle_deadline_ts` and state != Settled (or state Refunding). Returns stake. |

Settlement paths, in order of preference (decided by day-1 spikes #2/#3):
- **Path A (primary):** CPI into `validate_stat` as above. Verified interface in §7.5; CPI-ability itself is undocumented → spike #3.
- **Path B (fallback, still fully trustless):** read the `daily_scores_merkle_roots` PDA account data directly in our program and verify the Merkle chain ourselves. Requires reverse-engineering the hash scheme (spike #2b) and the PDA data layout (spike #2c). If Path B ships, *say so proudly in the docs* — an independent verifier is exactly the "custom check gate" the judges were told to value.
- **Path C (last resort, degrades trust honestly):** verify proof in the settler off-chain, store the full proof bytes in the settle tx for public auditability, document the trust delta prominently. Only if A and B both fail.

Do **not** renounce the upgrade authority until the final day (you need to ship fixes); renounce as the last pre-submission act and show it in the video.

### Program tests (Anchor, must-have)

- Payout math property tests: conservation (Σ payouts ≤ vault), all-tie → full refunds, single entry, max entries, median edge cases (odd/even counts).
- Settle rejects: wrong stat keys, wrong fixture, tampered proof bytes (expect txoracle errors 6023/6003/6004/6021), settle before lock, double settle.
- Claim rejects: double claim, non-entrant, claim before settle. Refund only after deadline.

---

## 7. TxLINE integration reference (all verified 2026-07-09)

Raw markdown of any docs page: append `.md` to its URL. Docs index: `https://txline-docs.txodds.com/llms.txt`. OpenAPI: `https://txline.txodds.com/docs/docs.yaml`. Support: Discord `discord.com/invite/txodds`, hello@txodds.com.

### 7.1 Addresses & networks

| | Mainnet | Devnet |
|---|---|---|
| API origin | `https://txline.txodds.com` | `https://txline-dev.txodds.com` |
| txoracle program | `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA` | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |
| TxL mint (Token-2022) | `Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL` | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` |
| USDT mint | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | `ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh` |

**Never mix networks:** a devnet subscribe tx must be activated on `txline-dev`, mainnet on `txline`. IDLs (Anchor JSON + TS types, program name `txoracle`, v1.5.5) are embedded on `https://txline.txodds.com/documentation/programs/devnet` and `/programs/mainnet`. `validate_stat`, `validate_stat_v2`, `subscribe` are byte-identical across both networks.

### 7.2 Auth flow (required even for free tier)

```
1. POST {origin}/auth/guest/start            (no body) → { token: <jwt> }   // 30-day expiry, re-auth on 401
2. On-chain: txoracle.subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)           // user wallet signs & pays fees
3. Sign message  `${txSig}:${leagues.join(",")}:${jwt}`                     // empty leagues → `${txSig}::${jwt}`
   ed25519 detached (wallet.signMessage or nacl.sign.detached), base64-encode
4. POST {origin}/api/token/activate  {txSig, walletSignature, leagues:[]}   header: Authorization: Bearer <jwt>
   → apiToken (text/plain, e.g. "txoracle_api_...")
5. Every data request: BOTH headers  Authorization: Bearer <jwt>  AND  X-Api-Token: <apiToken>
```

`subscribe` accounts (camelCase in TS): `user` (signer), `pricingMatrix` (PDA `["pricing_matrix"]`), `tokenMint` (TxL), `userTokenAccount` (TxL ATA, Token-2022), `tokenTreasuryVault`, `tokenTreasuryPda` (PDA `["token_treasury_v2"]`), `tokenProgram` = TOKEN_2022, `associatedTokenProgram`, `systemProgram`. Args: `service_level_id: u16`, `weeks: u8` (multiples of 4).

**Free tiers:** mainnet level `1` = World Cup & Int'l Friendlies, 60s delay, free; mainnet level `12` = **same, REAL-TIME, free**; devnet level `1` = 0s delay, free. Free tiers charge 0 TxL but the on-chain tx is still required. No rate limits on any tier. The active QF capture uses devnet level 1, which exposes the real World Cup fixture with no feed delay.

### 7.3 Data endpoints used

| Purpose | Endpoint |
|---|---|
| Fixture list | `GET /api/fixtures/snapshot?startEpochDay=&competitionId=` → `[{FixtureId(i64), StartTime(ms), Participant1/2, Competition, CompetitionId, ...}]` |
| Live scores (SSE) | `GET /api/scores/stream?fixtureId=` — headers: both auth + `Accept: text/event-stream` (+ `Accept-Encoding: gzip`, 70–80% smaller; gunzip chunks). Data msgs: `id` = `timestamp:index`, `data` = one Scores JSON. Heartbeats: `event: heartbeat`. Resume: `Last-Event-ID` header. |
| Live scores (poll fallback) | `GET /api/scores/updates/{fixtureId}` (current 5-min cache) / `GET /api/scores/snapshot/{fixtureId}?asOf=` |
| Full match replay | `GET /api/scores/historical/{fixtureId}` — only for fixtures started 6h–2weeks ago |
| Historical intervals | `GET /api/scores/updates/{epochDay}/{hourOfDay}/{interval}` (5-min buckets, 0–11 per hour) |
| **Settlement proofs** | `GET /api/scores/stat-validation?fixtureId=&seq=&statKey=&statKey2=` (legacy 2-stat mode) or `&statKeys=` (V2 N-stat mode; modes mutually exclusive) |
| Odds (nice-to-have UI) | `GET /api/odds/snapshot/{fixtureId}`, `GET /api/odds/stream` — consensus "StablePrice" feed; `Prices` int scaling undocumented (spike #8) |

Scores record essentials: `fixtureId`, `seq` (int32, per-fixture sequence — **this is the settlement cursor**), `ts` (ms), `statusSoccerId` (phase), `scoreSoccer.Participant1/2.{H1,H2,ET1,ET2,PE,Total}.{Goals,YellowCards,RedCards,Corners}`, `stats` (map statKey→value), `dataSoccer.{Goal,Corner,RedCard,Minutes,Clock}`.

### 7.3a Lossless recording and one-second replay

The live recorder appends every score and odds SSE envelope unchanged to `recordings/<network>/<fixtureId>/scores.ndjson` and `odds.ndjson`. It is intentionally action-driven rather than polling: the raw files retain the source truth and reconnect cursor.

```bash
npm run record --workspace=@exact-match/ingest -- --fixture 18209181 --network devnet --odds
npm run materialize --workspace=@exact-match/ingest -- --network devnet --fixture 18209181 --allow-partial --watch
```

The materializer atomically rebuilds `timeline-1s.ndjson` every ten seconds. It emits one self-contained row for every wall second from kickoff using last-observation-carried-forward, retains each complete source update in the corresponding row, and marks a second `unknown` when no trustworthy opening baseline exists. It never invents a 0–0 opening. After the match becomes eligible for TxLINE historical replay, run `backfill` and then materialize without `--allow-partial`; that deterministic strict pass fills the missed opening, verifies sequence/terminal coverage, and produces `timeline-1s.manifest.json` with `complete: true`.

### 7.4 Stat keys & phases (settlement vocabulary)

Stat key = `(period * 1000) + base_key`. Base: `1`/`2` = P1/P2 goals, `3`/`4` = yellows, `5`/`6` = reds, `7`/`8` = corners. Periods: full game +0, H1 +1000, H2 +2000, ET1 +3000, ET2 +4000, penalty shootout +5000. (First-half total goals = keys `1001` + `1002`.)

Game phases: NS 1, H1 2, **HT 3**, H2 4, **F 5**, WET 6, ET1 7, HTET 8, ET2 9, **FET 10**, WPE 11, PE 12, **FPE 13**, I 14, A 15, C 16, TXCC 17, TXCS 18, P 19. Knockout FT pools must accept F/FET/FPE as terminal (a WC final can end 13).

### 7.5 `validate_stat` (from the devnet IDL, exact)

- Accounts: **one** — `daily_scores_merkle_roots` (read-only, no signer).
- Args in order: `ts: i64` (= `summary.updateStats.minTimestamp`, ms), `fixture_summary: ScoresBatchSummary {fixture_id: i64, update_stats {update_count: i32, min_timestamp: i64, max_timestamp: i64}, events_sub_tree_root: [u8;32]}` (API calls this field `eventStatsSubTreeRoot` — rename when building the ix), `fixture_proof: Vec<ProofNode>`, `main_tree_proof: Vec<ProofNode>`, `predicate: TraderPredicate {threshold: i32, comparison: GreaterThan|LessThan|EqualTo}`, `stat_a: StatTerm {stat_to_prove: ScoreStat{key: u32, value: i32, period: i32}, event_stat_root: [u8;32], stat_proof: Vec<ProofNode>}`, `stat_b: Option<StatTerm>`, `op: Option<Add|Subtract>`. Returns `bool`. `ProofNode = {hash: [u8;32], is_right_sibling: bool}`.
- Client example uses `ComputeBudgetProgram.setComputeUnitLimit({units: 1_400_000})` and `.view()`. Proof hash strings arrive as base64 or 0x-hex (32 bytes).
- Errors to expect/demo: 6003 InvalidSubTreeProof, 6004 InvalidMainTreeProof, 6007 RootNotAvailable (root not yet posted for the 5-min slot), 6013 InvalidTimeSlot, **6021 PredicateFailed**, **6023 InvalidStatProof**.
- `validate_stat_v2(payload: StatValidationInput, strategy: NDimensionalStrategy)` — `NDimensionalStrategy {geometric_targets: [{stat_index: u8, prediction: i32}], distance_predicate: Option<TraderPredicate>, discrete_predicates: [...]}` = native closeness validation (stretch goal, spike #5).

### 7.6 Root PDA derivation

```ts
const epochDay = Math.floor(summary.updateStats.minTimestamp / 86_400_000);   // from the PROOF's ts, not wall clock
const [dailyScoresPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],  // u16 LE
  TXORACLE_PROGRAM_ID
);
```

Roots are stored per 5-minute slot per epoch-day PDA (insert ix takes `epoch_day u16, hour_of_day u8, minute_of_hour u8, root`). Posting cadence/lag: spike #4.

### 7.7 Known World Cup fixtureIds (from the docs schedule page)

QF July 9 20:00 UTC: `18209181` France–Morocco. Earlier rounds for replay/testing: `18198205` Portugal–Spain (July 6), `18172489` Brazil–Japan (June 29), `17588310` Tunisia–Japan (June 21). Schedule page: `documentation/scores/schedule` (62 fixtures listed as of Jul 9; knockout fixtureIds appear only after the previous round — poll `/api/fixtures/snapshot`). The World Cup `competitionId` is NOT documented → discover it via spike #7 and hard-code after.

---

## 8. Day-1 spikes (do these FIRST)

Each is ~30–90 min; together they retire every assumption this design leans on. Run #1 and #9 immediately — a quarterfinal kicks off July 9, 20:00 UTC.

1. **Auth end-to-end on devnet**: guest JWT → `subscribe(1, 4)` from a fresh wallet (does it work with no TxL ATA? expect yes, price = 0) → activate → hit `/api/fixtures/snapshot`. Repeat on mainnet with level 12 for the real-time recorder key.
2. **Proof round-trip off-chain→on-chain**: pull a proof via `stat-validation` for a finished WC fixture (use `17588310` etc. + `/api/scores/historical` to find the final `seq`), then run `validateStat(...).view()` on devnet exactly as §7.5. (a) Does devnet anchor real WC fixtures (or only test data)? (b) If time allows, brute the hash scheme (sha256/keccak over borsh-serialized ScoreStat) so Path B stays open. (c) Dump the roots-PDA raw data and locate the known root.
3. **CPI test**: minimal Anchor program that CPIs `validate_stat` and reads the bool via `get_return_data()`. This is THE go/no-go for Path A.
4. **CU + latency**: `simulateTransaction` with a real proof → `unitsConsumed` (1-stat and 2-stat); measure tx size vs the 1232-byte packet limit (proofs are 33 bytes/node × 3 proof vectors — if oversized, test `validate_stat_v2` or split); after a live goal, poll `stat-validation` and time how long until the root is posted (error 6007 → 200).
5. **`EqualTo` + `Add` semantics**: prove "corners_P1 + corners_P2 == actual" on a finished match. Also try `validate_stat_v2` with one geometric target + distance predicate.
6. **Phase settlement rule**: determine how to prove "the match reached phase F" — check whether the `stats` map at the final `seq` includes a phase/status stat key, or whether requesting the stat at a seq whose record has `statusSoccerId: F` is sufficient (and what txoracle actually binds: any seq's batch, or the value at that seq). This defines the settle instruction's exact requirements — **write up the chosen rule in `docs/settlement-spec.md`** (this doc is a judging deliverable).
7. **World Cup competitionId**: `GET /api/fixtures/snapshot` unfiltered, read `CompetitionId` off fixture `18209181`.
8. **Wire-format probes** (30 min, script it): `statusSoccerId` JSON shape (string vs object vs number), `stats` map key format ("7" vs 7), proof hash encoding (base64 vs hex), odds `Prices` scaling vs `Pct`.
9. **Start the recorder** on tonight's QF via mainnet level 12: raw SSE frames (scores + odds), one file per stream, timestamped. Also capture `scores/historical` for 2–3 finished matches as replay fixtures.

## 9. Nine-day plan

| Day | Deliverable |
|---|---|
| 1 (Jul 10) | Spikes 1–9. Recorder capturing. Go/no-go on Path A vs B. |
| 2 | Anchor program: accounts + create/enter + tests. Ingest service: SSE client + replayer working off recorded QF. |
| 3 | `settle` with real CPI + `claim` + full test suite green on devnet against a real recorded fixture's proofs. |
| 4 | Settler crank bot end-to-end: replayed match → auto-settle → claims. Web app skeleton: fixtures, pool cards, wallet, faucet button. |
| 5 | Slider UI + crowd histogram + payout preview. Watch-phase live view wired to ingest websocket. |
| 6 | Settlement receipt + proof viewer. Polish pass. **Record semifinal #1 (Jul 14) live as demo b-roll + fresh replay data.** |
| 7 | Deploy web app; create the judges' pre-funded pool; dry-run the full demo flow twice. **Record semifinal #2 (Jul 15).** |
| 8 | Shoot + edit demo video (script exists — robbery beat, halftime settlement beat). Write `docs/` (settlement spec, TxLINE feedback, tech overview). |
| 9 (Jul 18) | Buffer. Renounce upgrade authority on camera. Submit on Superteam Earn (deadline Jul 19 23:59 UTC — do NOT wait for the final). |

## 10. Deliberate cuts (do not build)

No AMM/orderbook, no in-play entries, no user-created pool templates (curated per fixture), no mainnet money, no mobile app, no protocol fee, no player-level props, no odds-based pricing, no multi-entry per wallet, no NFT receipts. WHEN-pools (§5.1 P2) only if days 1–5 run clean.

## 11. Compliance & framing

Devnet tokens only — no real-money wagering. Frame consistently as **skill-based precision forecasting** (accuracy-weighted, median-rule) rather than betting; the TxLINE credit token is never touched by our program (docs forbid P2P use of TxL — our escrow is devnet USDT, which is explicitly what the track invites). Include the standard "participants responsible for legal compliance" note in the repo.

## 12. Repo layout

```
program/            # Anchor workspace (exact_match program + txoracle CPI interface from published IDL)
services/ingest/    # auth, SSE client, recorder (raw frames → ./recordings), replayer, ws fan-out
services/settler/   # phase watcher + proof fetcher + settle/refund crank (permissionless, documented runbook)
web/                # Next.js app
docs/               # settlement-spec.md, txline-feedback.md, architecture.md, demo-script.md
recordings/         # captured SSE frames (gitignore raw, keep one sample fixture for CI replay tests)
```

---

*Build note for the implementing agent: when docs and this README disagree, re-fetch the docs (append `.md` to any docs URL for raw markdown) and update this file. Log every API friction point in `docs/txline-feedback.md` as you hit it — it is a required submission artifact.*
