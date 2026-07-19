"use client";

import { useMemo, useState } from "react";
import { useConnection, useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { computePayouts } from "@exact-match/payout";
import { C, num } from "@/lib/tokens";
import { EventIcon } from "@/components/Icons";
import { team, mmss } from "@/lib/demo";
import { GOAL_POOLS, bucketLabel, bucketOf, type GoalPool } from "@/lib/pools";
import {
  buildClaimTx,
  buildEnterTx,
  explorerTx,
  getProgram,
  toUsdc,
  usdcToBase,
  type OnChainPool,
} from "@/lib/chain";
import type { Marker } from "@/components/Timeline";

/** Matches the program's own bounds (MIN_STAKE / MAX_STAKE in lib.rs). */
const MIN_STAKE = 1;
const MAX_STAKE = 100;

export interface Call {
  marker: Marker;
  pool: GoalPool;
  bucket: number;
  onChain: OnChainPool | null;
  /** This wallet's existing entry in that pool, if it already staked. */
  mine: { guess: number; stake: number; claimed: boolean } | null;
}

/**
 * Turn the timeline's goal markers into pool calls.
 *
 * A lane's markers are ranked by time, and the Nth is the call on that team's Nth
 * goal — which is why placing a marker earlier than an existing one silently
 * renumbers both. That is the intent: the timeline is a prediction of the match's
 * shape, so "ARG's 2nd goal" is whatever you drew second, not whatever you clicked second.
 */
export function callsFrom(
  markers: Marker[],
  pools: Record<number, OnChainPool | null>,
  wallet: string | null,
): Call[] {
  const out: Call[] = [];

  for (const side of ["home", "away"] as const) {
    const lane = markers
      .filter((m) => m.kind === "goal" && m.side === side)
      .sort((a, b) => a.second - b.second);

    // Hydrated markers own their pool outright. Drawn markers then fill the
    // ordinals those left free, in time order — otherwise a new marker drawn
    // before a staked one would try to claim a pool this wallet already entered.
    const taken = new Set(
      lane.map((m) => m.poolIndex).filter((i): i is number => i !== undefined),
    );
    const free = GOAL_POOLS.filter((p) => p.side === side && !taken.has(p.poolIndex));
    let next = 0;

    for (const marker of lane) {
      const pool =
        marker.poolIndex !== undefined
          ? GOAL_POOLS.find((p) => p.poolIndex === marker.poolIndex)
          : free[next++];
      if (!pool) continue; // more markers than pools on this lane — not stakeable

      const onChain = pools[pool.poolIndex] ?? null;
      const mineRaw = wallet ? onChain?.entries.find((e) => e.wallet === wallet) : undefined;
      out.push({
        marker,
        pool,
        bucket: bucketOf(marker.second),
        onChain,
        mine: mineRaw
          ? { guess: mineRaw.guess, stake: mineRaw.stake, claimed: mineRaw.claimed }
          : null,
      });
    }
  }

  return out.sort((a, b) => a.pool.poolIndex - b.pool.poolIndex);
}

export function BetPanel({
  markers,
  pools,
  fixtureId,
  selectedId,
  onSelect,
  onRemove,
  onRefresh,
}: {
  markers: Marker[];
  pools: Record<number, OnChainPool | null>;
  /**
   * The demo's live namespace. Must be passed explicitly: a reset mints a new
   * fixture at runtime, so anything falling back to the build-time default would
   * sign against whichever pools happened to exist when the app was built.
   */
  fixtureId: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Drop an unstaked call. Staked ones are on-chain and cannot be removed. */
  onRemove: (id: string) => void;
  onRefresh: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { setVisible } = useWalletModal();

  const [stake, setStake] = useState(25);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string; sig?: string } | null>(
    null,
  );

  const me = publicKey?.toBase58() ?? null;
  const calls = useMemo(() => callsFrom(markers, pools, me), [markers, pools, me]);

  const pending = calls.filter((c) => !c.mine);
  const staked = calls.filter((c) => c.mine);

  const claimable = useMemo(
    () =>
      calls.filter(
        (c) => c.mine && !c.mine.claimed && c.onChain?.state === 1, // Settled
      ),
    [calls],
  );

  /**
   * What the pot would pay if the match ended with each call exact — computed by
   * the same README §5.3 function the program runs, against the pool's real
   * entries plus this one. Not a multiplier: with no other entrants you simply get
   * your stake back, and that is the honest number to show.
   */
  const projected = useMemo(() => {
    let total = 0n;
    for (const c of pending) {
      const others = (c.onChain?.entries ?? []).map((e) => ({
        guess: e.guess,
        stake: BigInt(e.stake),
      }));
      const mineStake = BigInt(usdcToBase(stake));
      const entries = [...others, { guess: c.bucket, stake: mineStake }];
      const res = computePayouts(entries, c.bucket); // assume this call lands exactly
      total += res.entries[entries.length - 1]!.payout;
    }
    return total;
  }, [pending, stake]);

  const totalStake = pending.length * stake;

  const placeCalls = async () => {
    if (!publicKey || !anchorWallet) {
      setVisible(true);
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const program = getProgram(anchorWallet);
      const tx = await buildEnterTx(
        program,
        publicKey,
        pending.map((c) => ({
          poolIndex: c.pool.poolIndex,
          bucket: c.bucket,
          stakeBase: usdcToBase(stake),
        })),
        fixtureId,
      );
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setStatus({ kind: "ok", msg: `Placed ${pending.length} call(s)`, sig });
      onRefresh();
    } catch (e) {
      setStatus({ kind: "err", msg: humanError(e) });
    } finally {
      setBusy(false);
    }
  };

  const claimAll = async () => {
    if (!publicKey || !anchorWallet) return;
    setBusy(true);
    setStatus(null);
    try {
      const program = getProgram(anchorWallet);
      const tx = await buildClaimTx(
        program,
        publicKey,
        claimable.map((c) => c.pool.poolIndex),
        fixtureId,
      );
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setStatus({ kind: "ok", msg: `Claimed ${claimable.length} pool(s)`, sig });
      onRefresh();
    } catch (e) {
      setStatus({ kind: "err", msg: humanError(e) });
    } finally {
      setBusy(false);
    }
  };

  const locked = calls.some((c) => c.onChain && Date.now() / 1000 >= c.onChain.lockTs);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", paddingBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em" }}>YOUR CALLS</span>
        <span style={{ ...num, fontSize: 11, color: C.muted }}>{calls.length}</span>
      </div>

      {calls.length === 0 && (
        <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, paddingBottom: 12 }}>
          No calls yet. Click a lane to call when that team scores — the first marker on a
          lane is their 1st goal, the second is their 2nd.
        </div>
      )}

      {calls.map((c) => {
        const t = team(c.marker.side);
        const isSel = c.marker.id === selectedId;
        const pot = c.onChain ? toUsdc(c.onChain.totalStaked) : 0;
        const crowd = c.onChain?.entries.length ?? 0;
        return (
          // A row is a container, not a button: the remove control is a button of
          // its own and nesting one inside another is invalid.
          <div
            key={c.marker.id}
            style={{
              display: "flex",
              alignItems: "center",
              borderLeft: `2px solid ${isSel ? t.color : "transparent"}`,
              borderBottom: `1px solid ${C.line2}`,
            }}
          >
            <button
              onClick={() => onSelect(c.marker.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flex: 1,
                minWidth: 0,
                textAlign: "left",
                background: "none",
                border: "none",
                padding: "9px 4px 9px 9px",
              }}
            >
              <EventIcon kind="goal" size={15} />
              <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: t.color }}>{c.pool.label}</span>
                <span style={{ fontSize: 10, color: C.muted }}>
                  window {bucketLabel(c.bucket)} · pot {pot.toFixed(2)} USDC · {crowd} in
                </span>
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                <span style={{ ...num, fontSize: 13, fontWeight: 700 }}>{mmss(c.marker.second)}</span>
                {c.mine && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.ink2, letterSpacing: "0.06em" }}>
                    STAKED {toUsdc(c.mine.stake).toFixed(2)}
                  </span>
                )}
              </span>
            </button>

            {/*
              Only unstaked calls can be dropped. A staked one is an on-chain entry:
              the program has no cancel, so offering a cross there would promise
              something the chain will not do. Those show a lock instead.
            */}
            {c.mine ? (
              <span
                title="Staked on-chain — entries cannot be cancelled"
                style={{ width: 26, textAlign: "center", fontSize: 11, color: C.faint, cursor: "default" }}
              >
                🔒
              </span>
            ) : (
              <button
                onClick={() => onRemove(c.marker.id)}
                title={`Remove your ${c.pool.label} call`}
                aria-label={`Remove your ${c.pool.label} call`}
                style={{
                  width: 26,
                  height: 26,
                  flexShrink: 0,
                  marginRight: 2,
                  border: "none",
                  background: "none",
                  borderRadius: 5,
                  color: C.faint,
                  fontSize: 15,
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = C.surface;
                  e.currentTarget.style.color = C.live;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.color = C.faint;
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      {/* Stake — test USDC, matching the program's 1–100 bounds. */}
      {pending.length > 0 && !locked && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 0 12px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Stake per call</span>
            <span style={{ fontSize: 10, color: C.muted }}>test USDC · 1–100</span>
          </span>
          <input
            type="number"
            min={MIN_STAKE}
            max={MAX_STAKE}
            step={1}
            value={stake}
            onChange={(e) =>
              setStake(
                Math.min(MAX_STAKE, Math.max(MIN_STAKE, Number(e.target.value) || MIN_STAKE)),
              )
            }
            style={{
              ...num,
              width: 78,
              border: `1px solid ${C.line}`,
              borderRadius: 6,
              padding: "8px 10px",
              fontSize: 14,
              fontWeight: 700,
              textAlign: "right",
            }}
          />
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${C.line2}`, paddingTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: C.muted }}>Total stake</span>
            <span style={{ ...num, fontWeight: 700 }}>{totalStake.toFixed(2)} USDC</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: C.muted }}>Projected if all land</span>
            <span style={{ ...num, fontWeight: 800 }}>{toUsdc(projected).toFixed(2)} USDC</span>
          </div>
          <span style={{ fontSize: 10, color: C.muted, lineHeight: 1.6, paddingTop: 2 }}>
            Computed from the pools&apos; real entries by the same payout function the program
            runs on-chain. Exact and lonely pays most; if you are the only entrant you simply
            get your stake back.
          </span>
        </div>
      )}

      {staked.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 10.5, color: C.ink2, lineHeight: 1.6 }}>
          {staked.length} call{staked.length > 1 ? "s" : ""} already on-chain. One entry per
          wallet per pool — move a marker to a different window and it stays as staked.
        </div>
      )}

      {status && (
        <div
          style={{
            marginTop: 12,
            border: `1px solid ${status.kind === "ok" ? C.line : C.live}`,
            borderRadius: 8,
            padding: "9px 11px",
            fontSize: 11,
            color: status.kind === "ok" ? C.ink2 : C.live,
            lineHeight: 1.5,
          }}
        >
          {status.msg}
          {status.sig && (
            <>
              {" · "}
              <a href={explorerTx(status.sig)} target="_blank" rel="noreferrer" style={{ color: C.ink }}>
                view tx
              </a>
            </>
          )}
        </div>
      )}

      {claimable.length > 0 && (
        <button
          onClick={claimAll}
          disabled={busy}
          style={{
            marginTop: 14,
            border: "none",
            borderRadius: 8,
            padding: "12px 16px",
            fontSize: 13.5,
            fontWeight: 700,
            background: C.ink,
            color: C.white,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Confirming…" : `Claim ${claimable.length} settled pool(s)`}
        </button>
      )}

      {pending.length > 0 && !locked && (
        <button
          onClick={placeCalls}
          disabled={busy}
          style={{
            marginTop: 14,
            border: "none",
            borderRadius: 8,
            padding: "12px 16px",
            fontSize: 13.5,
            fontWeight: 700,
            background: busy ? C.line2 : C.ink,
            color: busy ? C.faint : C.white,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy
            ? "Confirming…"
            : connected
              ? `Place ${pending.length} call${pending.length > 1 ? "s" : ""} · ${totalStake.toFixed(2)} USDC`
              : "Connect Wallet to place calls"}
        </button>
      )}

      {locked && pending.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
          Entries closed at kickoff — these calls were not staked in time.
        </div>
      )}
    </div>
  );
}

/**
 * Anchor errors are verbose and wallet-adapter flattens them to "Unexpected
 * error", which tells the user nothing. Dig the program logs out first — that is
 * where the actual constraint that failed is named.
 */
function humanError(e: unknown): string {
  let s = e instanceof Error ? e.message : String(e);
  const logs = (e as { logs?: string[] })?.logs;
  if (logs?.length) s += " " + logs.join(" ");
  if (/User rejected|rejected the request/i.test(s)) return "Wallet rejected the transaction.";
  if (/PoolLocked/.test(s)) return "Entries closed at kickoff.";
  if (/AlreadyEntered/.test(s)) return "This wallet already entered one of these pools.";
  if (/StakeOutOfRange/.test(s)) return "Stake must be between 1 and 100 USDC.";
  // A wallet that has never held the token has no ATA, so `enter` fails on
  // user_token before it ever reaches the transfer. Both of these mean the same
  // thing to a user: go get some test USDC.
  if (/AccountNotInitialized|could not find account/i.test(s))
    return "No USDC yet — get some at /mint, then try again.";
  if (/insufficient funds|InsufficientFunds/i.test(s))
    return "Not enough USDC — get more at /mint.";
  if (/insufficient lamports/i.test(s)) return "Not enough SOL for the transaction fee.";
  if (/NotSettled/.test(s)) return "That pool has not settled yet.";
  if (/NotAnEntrant/.test(s)) return "This wallet has no entry in that pool.";
  if (/AlreadyClaimed/.test(s)) return "Already claimed.";
  if (/AccountNotInitialized.*pool|could not find account/i.test(s))
    return "Those pools no longer exist — hit Pre-match to rebuild the demo.";
  const m = /Error Message: ([^.]+)/.exec(s);
  return m ? m[1]! : s.slice(0, 160);
}
