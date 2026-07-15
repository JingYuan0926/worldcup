# Exact Match — project instructions

Precision prediction pools for the 2026 World Cup, settled trustlessly by TxLINE Merkle proofs on Solana. Hackathon entry: TxODDS World Cup Hackathon, **Prediction Markets & Settlement** track, submission deadline **July 19, 2026 23:59 UTC** on Superteam Earn.

**`README.md` is the single source of truth** — full product spec, payout math, Anchor program spec, verified TxLINE API reference, day-1 spikes, 9-day plan. Read it before writing any code. `docs/TASKS.md` is the execution checklist — work through it phase by phase and tick items off as you complete them.

## Current state (updated 2026-07-15)

- The TypeScript monorepo now includes TxLINE authentication, recording, replay/materialization, live fanout, settlement planning, payout math, and the Exact Match web demo.
- The design was pressure-tested through several iterations with the user: a white, Polymarket-inspired exact-time timeline with independent event markers, sparse per-second crowd data, no admin key, and devnet-only demo funds.
- The automatic recorder plans upcoming fixtures and stores raw TxLINE frames outside Git. Preserve recordings locally; keep only the small synthetic sample fixture in version control.

## Environment constraints

- **Solana CLI / Anchor toolchain is NOT installed** on this machine, and the user wants smart-contract build/deploy deferred.
- This blocks: `anchor build`/`deploy`, and README spike #3 (the CPI test program).
- This does NOT block (all pure npm, no CLI needed):
  - TxLINE auth spike incl. the on-chain `subscribe` tx — send it with `@solana/web3.js` + `@coral-xyz/anchor` from Node using a generated keypair (devnet SOL via `requestAirdrop`).
  - `validateStat(...).view()` proof round-trip (spike #2) — it calls TxLINE's *already-deployed* txoracle program; nothing of ours needs deploying.
  - The recorder, replayer, ingest service, settler logic, the entire web app, and the Anchor program *source code* + unit-testable payout math (pure Rust/TS functions).
- When the toolchain becomes necessary (program build/test/deploy), ask the user before installing anything system-wide.

## Conventions

- Monorepo: npm workspaces — `program/`, `services/ingest/`, `services/settler/`, `web/`, `docs/`, `recordings/` (layout in README §12).
- TypeScript strict everywhere; Next.js App Router + Tailwind for `web/`; vitest for TS tests.
- Payout math implemented once as a pure function (integer-only, README §5.3), mirrored exactly in Rust (program) and TS (UI preview + settler) with a shared test-vector JSON file so the two implementations can never drift.
- Secrets/config in `.env` (never commit): wallet keypair path, TxLINE JWT + API token per network. Raw recordings are gitignored except one small sample fixture kept for CI replay tests.
- Log every TxLINE API friction point in `docs/txline-feedback.md` as you hit it — it is a required submission artifact.

## Key gotchas (each verified; details in README §7)

1. Every TxLINE data request needs BOTH headers: `Authorization: Bearer <jwt>` AND `X-Api-Token: <token>`.
2. Never mix networks: devnet subscribe tx → `txline-dev.txodds.com` only. App runs on devnet (service level 1, free, real-time); recorder uses mainnet level 12 (free, real-time).
3. Devnet USDT and TxL mints are **Token-2022** — use `token_interface` in Anchor and `TOKEN_2022_PROGRAM_ID` in TS.
4. The API's `eventStatsSubTreeRoot` field is named `events_sub_tree_root` on-chain; proof hashes arrive as base64 or 0x-hex, must be exactly 32 bytes.
5. WHEN pools settle on 5-minute buckets (on-chain root granularity), never on exact minutes. UI shows minutes, money settles buckets.
6. Append `.md` to any TxLINE docs URL for raw markdown; index at `https://txline-docs.txodds.com/llms.txt`.
7. The program must have **no admin key on any instruction** — this is a headline feature; do not add an authority "temporarily".

## UI design direction (keep it consistent)

White, restrained prediction-market theme: white surfaces, grey type and passed-time hatching, with blue/red reserved for the two country lanes and important state. System font stack + tabular-nums mono for all numbers/countdowns. The **timeline canvas is the hero** (README §5.4): exact-time event markers, sparse crowd distributions, sweeping match clock/replay, and settlement receipt with the Merkle proof viewer. Mobile-first layout, but the demo video will be shot on desktop — make 1280px look excellent.

## Deadlines that gate work

| Date (UTC) | Event |
|---|---|
| Jul 9–11 | Quarterfinals — recorder must capture at least one |
| Jul 14–15 | Semifinals — live demo b-roll + fresh replay data |
| Jul 18 | Everything done; renounce upgrade authority; submit |
| Jul 19 23:59 | Hard deadline (do NOT wait for the final on Jul 19) |
