"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { computePayouts } from "@exact-match/payout";
import { C, num } from "@/lib/tokens";
import { EventIcon } from "@/components/Icons";
import { team } from "@/lib/demo";
import { GOAL_POOLS, bucketLabel } from "@/lib/pools";
import { explorerAddress, toUsdc, type OnChainPool } from "@/lib/chain";

/**
 * What actually happened, read from the chain.
 *
 * This panel used to render a hand-written Merkle proof for a different fixture,
 * next to invented usernames and payouts. Everything here is now the real settled
 * state of the six goal pools, with the split recomputed by the same README §5.3
 * function the program runs in `claim` — so what you read is what the vault paid.
 *
 * The proof viewer (README §5.4) is deliberately absent rather than faked: this
 * build settles by resolver signature, and there is no Merkle proof to show until
 * the `validate_stat` CPI lands. Showing one anyway would misrepresent the exact
 * thing the product's pitch rests on.
 */
export function SettlementPanel({ pools }: { pools: Record<number, OnChainPool | null> }) {
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58() ?? null;

  const rows = useMemo(
    () =>
      GOAL_POOLS.map((gp) => {
        const pool = pools[gp.poolIndex] ?? null;
        if (!pool || pool.state !== 1 || pool.entries.length === 0) return null;
        const res = computePayouts(
          pool.entries.map((e) => ({ guess: e.guess, stake: BigInt(e.stake) })),
          pool.actual,
        );
        const mineIdx = me ? pool.entries.findIndex((e) => e.wallet === me) : -1;
        return { gp, pool, res, mineIdx };
      }).filter(Boolean) as {
        gp: (typeof GOAL_POOLS)[number];
        pool: OnChainPool;
        res: ReturnType<typeof computePayouts>;
        mineIdx: number;
      }[],
    [pools, me],
  );

  if (rows.length === 0) {
    return (
      <div
        style={{
          border: `1px solid ${C.line}`,
          borderRadius: 10,
          padding: 16,
          fontSize: 12,
          color: C.muted,
          lineHeight: 1.6,
        }}
      >
        No pool with entries has settled yet. Once the outcome is posted, every entrant&apos;s
        split is recomputed on-chain and shown here.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em" }}>SETTLEMENT</span>
        <span style={{ fontSize: 10.5, color: C.muted }}>
          outcome derived from the recorded TxLINE feed · payout recomputed on-chain in claim
        </span>
      </div>

      {rows.map(({ gp, pool, res, mineIdx }) => {
        const t = team(gp.side);
        const mine = mineIdx >= 0 ? res.entries[mineIdx] : null;
        return (
          <div
            key={gp.poolIndex}
            style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9, paddingBottom: 8, flexWrap: "wrap" }}>
              <EventIcon kind="goal" size={15} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: t.color }}>{gp.label}</span>
              <span style={{ fontSize: 11, color: C.muted }}>landed in {bucketLabel(pool.actual)}</span>
              <div style={{ flex: 1 }} />
              <a
                href={explorerAddress(pool.address)}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 10.5, color: C.muted }}
              >
                pool ↗
              </a>
            </div>

            <div style={{ display: "flex", gap: 18, fontSize: 10.5, color: C.muted, paddingBottom: 8, flexWrap: "wrap" }}>
              <span>
                pot <b style={{ ...num, color: C.ink }}>{toUsdc(res.vault).toFixed(2)} USDC</b>
              </span>
              <span>
                median error <b style={{ ...num, color: C.ink }}>{res.medianError}</b>
              </span>
              <span>
                losers&apos; pot <b style={{ ...num, color: C.ink }}>{toUsdc(res.losersPot).toFixed(2)}</b>
              </span>
              <span>
                dust <b style={{ ...num, color: C.ink }}>{Number(res.dust)}</b> base units
              </span>
            </div>

            {res.entries.map((e, i) => {
              const isMe = i === mineIdx;
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "5px 0",
                    borderTop: `1px solid ${C.line2}`,
                    fontSize: 11,
                    fontWeight: isMe ? 700 : 400,
                    color: isMe ? C.ink : C.ink2,
                  }}
                >
                  <span style={{ ...num, width: 92 }}>{bucketLabel(e.guess)}</span>
                  <span style={{ ...num, width: 46, color: C.muted }}>err {e.error}</span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      color: e.isWinner ? C.ink : C.faint,
                    }}
                  >
                    {e.isWinner ? "WIN" : "LOSE"}
                  </span>
                  <div style={{ flex: 1 }} />
                  {isMe && (
                    <span style={{ fontSize: 9, fontWeight: 800, color: t.color, letterSpacing: "0.06em" }}>
                      YOU
                    </span>
                  )}
                  <span style={{ ...num, width: 96, textAlign: "right" }}>
                    {toUsdc(e.payout).toFixed(2)} USDC
                  </span>
                </div>
              );
            })}

            {mine && (
              <div style={{ paddingTop: 8, fontSize: 11, color: C.ink2, lineHeight: 1.6 }}>
                You called {bucketLabel(mine.guess)} — {mine.isWinner ? "inside" : "outside"} the
                median error of {res.medianError}.{" "}
                {mine.isWinner
                  ? `Stake back plus a weighted share of the losers' pot: ${toUsdc(mine.payout).toFixed(2)} USDC.`
                  : "No payout on this pool."}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
