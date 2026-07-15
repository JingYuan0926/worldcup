# TxLINE API — Feedback

Required submission artifact (README §3). Written by the Exact Match team as we build against
TxLINE. Living document — we log friction **as we hit it**, so this grows through the build.
All observations below are against the **devnet** deployment (`https://txline-dev.txodds.com`,
txoracle `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`) unless noted, as of **2026-07-10**.

## What we liked

- **Trustless settlement is real, not a slogan.** Stats are anchored as Merkle roots on
  Solana and `validate_stat` verifies a proof against the on-chain
  `daily_scores_merkle_roots` PDA. Our whole product — settlement that no admin can forge —
  is only possible because the truth is a proof, not an API response. This is a genuinely
  differentiated primitive.
- **A composable on-chain verification instruction.** `validate_stat` taking a `predicate`
  (`GreaterThan | LessThan | EqualTo`) plus one or two `StatTerm`s combined with `Add /
  Subtract` is expressive enough to express both our COUNT pools ("corners P1 + P2 == 11" in
  a single call) and, via two bracketing proofs, our WHEN pools — without any bespoke oracle
  logic on our side. The `EqualTo` + `Add` combination was exactly what precision markets need.
- **A `.view()`-able verifier.** Being able to run `validate_stat(...).view()` off-chain
  against the already-deployed program lets us validate the entire proof interface **before**
  writing or deploying any of our own on-chain code. Excellent for de-risking.
- **Clean, well-modelled IDL.** The Anchor 0.31 new-format IDL is precise — struct/enum
  shapes (`ScoresBatchSummary`, `TraderPredicate`, `StatTerm`, `ProofNode`, …) map directly
  to a settle instruction. `request_devnet_faucet` on-chain (mints devnet USDT to the caller)
  is a thoughtful touch for a test-token faucet button.
- **Genuinely free real-time tiers.** Mainnet level 12 (real-time, free) and devnet level 1
  (0-delay, free) with no rate limits made it viable to both record a live match and drive a
  devnet app without cost.
- **Docs ergonomics.** Appending `.md` to any docs URL returns raw markdown (great for
  tooling), and `llms.txt` as an index is a nice affordance for building against the docs
  programmatically.

## Friction points (logged as hit)

1. **Data requests need BOTH headers, and a missing token gives only a terse 403.** Every
   data request must carry `Authorization: Bearer <jwt>` **and** `X-Api-Token: <apiToken>`.
   Sending only the JWT returns a bare `403 "Missing API token"` with no hint that a second
   header is required or how to obtain it. We only got past it by reading the auth section of
   the docs closely. *Suggestion:* have the 403 body name the missing header and link the
   activation flow.

2. **Even the FREE tier requires an on-chain `subscribe` tx before activation.** A guest JWT
   alone is not enough — `POST /api/token/activate` (and therefore every data endpoint)
   returns 403 until an on-chain `txoracle.subscribe(level, weeks)` transaction has been sent
   and its signature included in the activation. For a free tier this is real onboarding
   friction: a newcomer must fund a wallet, create token accounts, and land a transaction
   before receiving a single byte of data. *Suggestion:* document this prominently as a hard
   prerequisite (it is easy to assume "free" means "JWT-only"), or offer a JWT-only read path
   for the free tiers.

3. **The mainnet txoracle IDL is not fetchable via `anchor idl fetch`.** There is no on-chain
   IDL account for the mainnet program, so `anchor idl fetch <mainnet program id>` fails. We
   worked around it by reusing the devnet IDL and overriding the `address` field per cluster
   (the docs state `subscribe` / `validate_stat` are byte-identical across networks).
   *Suggestion:* publish an on-chain IDL account on mainnet, or clearly point to the embedded
   IDL as the canonical source.

4. **Version-label mismatch: on-chain devnet IDL reports `1.4.2`, docs/README referenced
   `1.5.5`.** The IDL metadata we read from the deployed devnet program is `version 1.4.2`
   (spec `0.1.0`), while the documentation pages referenced `v1.5.5`. The instruction we
   depend on (`validate_stat`) is present and its interface matches, but the label discrepancy
   made us unsure whether we were building against the current program. *Suggestion:* keep the
   published IDL version label in sync with what is deployed per network.

5. **`subscribe` appears to require the user's TxL Token-2022 ATA to pre-exist, even at
   price 0.** On a fresh wallet, the `subscribe` instruction reads the user's TxL associated
   token account; if it does not exist the transaction fails, even though the free tier costs
   0 TxL. We handle it by prepending a
   `createAssociatedTokenAccountIdempotentInstruction` for the TxL mint (Token-2022) so a
   brand-new wallet can subscribe in one shot. *Suggestion:* either create the ATA inside
   `subscribe` when the price is 0, or document that callers must create the TxL ATA first.

6. **`validate_stat_v2` (native N-dimensional closeness scoring) is referenced but absent
   from the devnet IDL.** The docs describe `validate_stat_v2(payload, NDimensionalStrategy)`
   with `geometric_targets` / `distance_predicate` — attractive for us as native "closeness"
   validation. The deployed **devnet** IDL (`v1.4.2`) exposes `validate_stat` but **no
   `validate_stat_v2`** (full instruction list checked). We designed settlement entirely on
   `validate_stat` + bracketing proofs as a result. *Suggestion:* clarify per network which
   `validate_stat` variants are actually deployed, or ship `validate_stat_v2` on devnet so it
   can be spiked. (Related to #4 — a symptom of the version drift.)

7. **The free-tier onboarding can miss a live-data window when the public devnet faucet is
   rate-limited.** At 20:16 UTC during France–Morocco, a fresh devnet wallet needed the one
   `subscribe` transaction required for activation, but three programmatic airdrop attempts
   all returned HTTP 429 and the official guidance redirected us to a manual faucet. The
   mainnet real-time tier was also free in TxL terms, but still required real SOL for fees and
   ATA rent. This distinction is documented, but it is easy to read “instant access,” “no
   payment required,” and the hackathon fee waiver as gasless access. *Suggestion:* issue a
   hackathon API sandbox token, sponsor the free-tier transaction, or add a clearly labelled
   gas/faucet readiness check before a live match begins.

8. **`/api/scores/historical/{fixtureId}` returned a buffered SSE transcript, not JSON.**
   Six hours after kickoff, the endpoint returned 1.2 MB of valid `text/event-stream`-style
   `data:` / `id:` blocks in a one-shot response. Treating the historical endpoint as JSON
   therefore produced an empty backfill even though all 1,116 frames were present. We now
   preserve the raw response and parse either documented JSON or the observed SSE format.
   *Suggestion:* document the historical response media type and envelope explicitly, and
   return a matching `Content-Type`; alternatively expose JSON/NDJSON as a separate format.

## TODO — friction we expect to hit (placeholders)

To be filled in as we complete the proof round-trip and on-chain spikes:

- [ ] **Proof payload shape from `/api/scores/stat-validation`** — exact JSON, field names
      vs the on-chain struct names (e.g. `eventStatsSubTreeRoot` → `events_sub_tree_root`),
      and proof-hash encoding (base64 vs `0x`-hex; must decode to exactly 32 bytes). Any
      surprises in mapping the REST payload to the CPI args.
- [ ] **`validate_stat` return value** — the devnet IDL declares no `returns` type on the
      instruction, though the docs say it returns `bool`. Record what a real `.view()`
      actually returns and how the bool is read (`get_return_data`), since our primary
      settlement path depends on it.
- [ ] **Compute-unit cost + transaction-size limits** — `unitsConsumed` for 1-stat and 2-stat
      `validate_stat`, and whether two bracketing proofs (3 proof vectors each, 33 bytes/node)
      fit one transaction under the 1232-byte packet limit or force a two-step commit.
- [ ] **Root-posting latency** — after a live goal, how long until the 5-minute-slot root is
      posted (i.e. how long `validate_stat` returns `6007 RootNotAvailable` before flipping to
      a verifiable proof). Gates how quickly a pool can settle post-event.
- [ ] **Phase / status binding** — whether `statusSoccerId` is provable as a stat leaf, and
      what a `validate_stat` proof actually commits to (a specific `seq`'s Scores record vs a
      5-minute batch window). Determines how we prove "the match reached full time." (See
      `docs/settlement-spec.md` §5.)
- [ ] **Does devnet anchor real World Cup fixtures** or only synthetic test data — affects
      whether we settle on devnet or must reach to mainnet roots.
- [ ] **Wire-format details** — `stats` map key format (`"7"` vs `7`), `statusSoccerId` shape
      (string/number/object), odds `Prices` integer scaling. (Captured in `docs/wire-notes.md`.)
