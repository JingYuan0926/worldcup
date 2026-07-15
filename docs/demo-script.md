# Demo video script — Exact Match (≤ 5:00)

> Judges see no live matches at review time — **the video is the product.** Shoot on desktop at
> 1280px (CLAUDE.md). Also ship the judge-testable artifact: a pre-funded pool on devnet the
> judges can settle themselves (see `docs/settler-runbook.md` + the Judges' replay room at `/replay`).
>
> The two beats that win the track: (1) **halftime flash settlement on-chain**, and (2) the
> **forged-proof robbery that fails on camera**. Everything else frames those.

| # | Time | Screen | On camera | Voiceover (tighten to fit) |
|---|------|--------|-----------|----------------------------|
| 0 | 0:00–0:15 | Title / home `/` | Logo, "The market that cannot cheat", the France–Morocco card, open pot + prediction count ticking. | "Prediction markets still trust a human to decide the truth. Exact Match doesn't. Predict an exact number, and a cryptographic proof settles the pot — no admin key, no oracle, no human." |
| 1 | 0:15–1:05 | Match entry `/match/18209181` | Drag the ⚽ marker onto the **20–25'** window (tooltip "settles by 5-minute window"); crowd heat strip lights up. Then the **Total corners** slider — drag to 10, the payout preview recomputes live ("if it lands exactly here → ≈ X USDT, 2.4×"). | "Paint the match before it happens. Each marker is its own pool. Slide to your number — the payout preview is the real §5.3 median-error math, recomputed in your browser. Be right where the crowd is wrong and you take most of the losers' pot." |
| 2 | 1:05–1:20 | Entry → lock | Countdown hits 00:00 at kickoff; pools flip to LOCKED. | "Predictions lock at kickoff. No in-play sniping — you predict, then you watch." |
| 3 | 1:20–2:05 | Watch phase (`/replay` stage 2, or match live mode) | The match clock sweeps across the timeline; the live ticker runs off the recorded TxLINE SSE feed; France score at 23' pins a true ⚽ to the timeline; the actual-value needle crawls across the corners histogram. | "Now the recorded TxLINE feed drives everything. The clock sweeps toward everyone's markers. A goal lands — the true event pins to the timeline and the nearest predictions light up." |
| 4 | 2:05–2:50 | **Halftime flash settlement** | At HT the First-half goals pool becomes settleable. Run the permissionless crank (terminal split-screen or a button); the settle tx confirms on devnet; needle lands on the actual (1); winners light up; animated payout split. | "Halftime — mid-broadcast — the first-half pool settles. Anyone can run the crank: it fetches TxLINE's Merkle proof and submits it. The program verifies the proof against TxLINE's on-chain root and splits the pot. No one waited for a human." |
| 5 | 2:50–3:50 | **The robbery** (settlement receipt) | Type a **forged** actual into the "try to settle with a fake value" box → red callout: `chain rejects — 6023 InvalidStatProof / 6021 PredicateFailed`. Then click **Submit the REAL proof** → it settles. | "Here's the whole thesis. Try to steal the pot with a forged stat — the chain rejects it. `InvalidStatProof`. `PredicateFailed`. Nothing but a valid TxLINE proof can move the money. Now the real proof lands… and the pot splits correctly." |
| 6 | 3:50–4:30 | Proof receipt + verify | Expand the proof viewer: raw Merkle proof JSON, the on-chain root PDA, a Solana Explorer link to the settle tx, and the "verify yourself" ladder walking the proof levels. | "Every settlement ships its receipt: the raw proof, the root PDA, the settle transaction, and a walk-through of the Merkle levels. Don't trust us — verify it yourself." |
| 7 | 4:30–4:50 | Repo / no-admin | `grep`-show that no instruction has an authority; renounce the upgrade authority on camera. | "No instruction has an admin key — grep it. And as the last step before submission, we renounce the upgrade authority. The rules can never change." |
| 8 | 4:50–5:00 | Judges' replay room `/replay` | CTA card: "Settle a pre-funded pool yourself — link in the description." | "There's a live pool on devnet waiting for you. Settle it yourself. Exact Match — the market that cannot cheat." |

## Shot list / assets to capture beforehand
- A clean run of `/match/18209181` entry (drag + slider + preview) at 1280px.
- A replayer run of the recorded QF (or the sample) through `/replay` for the watch + settlement beats.
- Terminal capture of the permissionless crank settling the flash pool on devnet (`npm run settle`).
- Terminal capture of `grep`-ing the program for any `authority`/`admin` (returns nothing) and the `solana program set-upgrade-authority --final` renounce.
- The forged-vs-real settlement toggle on the receipt screen.

## Notes
- Keep it under 5:00 hard. If tight, compress beat 1 and beat 6 — never cut beat 4 (halftime) or beat 5 (robbery).
- Money settles on 5-minute buckets; the UI shows minutes. Say "5-minute window" out loud once so judges know the honest granularity (see `docs/settlement-spec.md`).
