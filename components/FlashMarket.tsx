"use client";

import { useMemo, useState } from "react";
import { useConnection, useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { computePayouts } from "@exact-match/payout";
import { C, num } from "@/lib/tokens";
import { FLASH_POOL } from "@/lib/pools";
import {
  buildClaimTx,
  buildEnterTx,
  explorerTx,
  getProgram,
  toUsdc,
  usdcToBase,
  type OnChainPool,
} from "@/lib/chain";

const MIN_STAKE = 1;
const MAX_STAKE = 100;

/**
 * The in-play market, dropped mid-broadcast.
 *
 * It is a COUNT pool over minutes rather than a WHEN pool over buckets, so the
 * input is a slider on the match clock and it settles on the exact minute. That is
 * the whole reason the program's slider span had to stop being pinned to the
 * bucket vocabulary — this question's range is 0–124, not 0–20.
 */
export function FlashMarket({
  pool,
  fixtureId,
  onRefresh,
}: {
  pool: OnChainPool | null;
  fixtureId: number;
  onRefresh: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { setVisible } = useWalletModal();

  const [guess, setGuess] = useState(30);
  const [stake, setStake] = useState(25);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string; sig?: string } | null>(
    null,
  );

  const me = publicKey?.toBase58() ?? null;
  const mine = useMemo(
    () => (me ? pool?.entries.find((e) => e.wallet === me) ?? null : null),
    [pool, me],
  );

  const locked = pool ? Date.now() / 1000 >= pool.lockTs : false;
  const settled = pool?.state === 1;
  const secondsLeft = pool ? Math.max(0, Math.floor(pool.lockTs - Date.now() / 1000)) : 0;

  /** The crowd's shape, in minutes — the same read the lanes give for goals. */
  const histogram = useMemo(() => {
    const bins = 24; // ~5 minutes per bin across 0–124
    const out = Array.from({ length: bins }, () => 0);
    for (const e of pool?.entries ?? []) {
      const i = Math.min(bins - 1, Math.floor((e.guess / (FLASH_POOL.max + 1)) * bins));
      out[i] += e.stake;
    }
    return out;
  }, [pool]);

  const projected = useMemo(() => {
    if (!pool) return 0n;
    const entries = [
      ...pool.entries.map((e) => ({ guess: e.guess, stake: BigInt(e.stake) })),
      { guess, stake: BigInt(usdcToBase(stake)) },
    ];
    const res = computePayouts(entries, guess);
    return res.entries[entries.length - 1]!.payout;
  }, [pool, guess, stake]);

  const place = async () => {
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
        [{ poolIndex: FLASH_POOL.poolIndex, bucket: guess, stakeBase: usdcToBase(stake) }],
        fixtureId,
      );
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setStatus({ kind: "ok", msg: "Call placed", sig });
      onRefresh();
    } catch (e) {
      setStatus({ kind: "err", msg: humanError(e) });
    } finally {
      setBusy(false);
    }
  };

  const claim = async () => {
    if (!publicKey || !anchorWallet) return;
    setBusy(true);
    setStatus(null);
    try {
      const program = getProgram(anchorWallet);
      const tx = await buildClaimTx(program, publicKey, [FLASH_POOL.poolIndex], fixtureId);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setStatus({ kind: "ok", msg: "Claimed", sig });
      onRefresh();
    } catch (e) {
      setStatus({ kind: "err", msg: humanError(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!pool) return null;

  const maxBar = Math.max(1, ...histogram);
  const pot = toUsdc(pool.totalStaked);

  return (
    <div
      style={{
        border: `1px solid ${C.ink}`,
        borderRadius: 10,
        overflow: "hidden",
        animation: "v2-drop-in 0.45s cubic-bezier(.2,.9,.3,1.2) both",
      }}
    >
      <div
        style={{
          background: C.ink,
          color: C.white,
          padding: "9px 13px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: C.live,
            animation: "v2-pulse 1.2s infinite",
          }}
        />
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em" }}>
          FLASH MARKET
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ ...num, fontSize: 10.5, opacity: 0.75 }}>
          {settled ? "SETTLED" : locked ? "LOCKED" : `closes in ${secondsLeft}s`}
        </span>
      </div>

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35 }}>
          {FLASH_POOL.question}
        </div>
        <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5, marginTop: -6 }}>
          Every stretch where the scores are equal, added up — 0–0 from kickoff counts.
          Pot {pot.toFixed(0)} USDC · {pool.entries.length} in.
        </div>

        {/* The crowd, in minutes. Same idea as the lanes: are you with them or alone? */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 34 }}>
          {histogram.map((v, i) => {
            const binMin = Math.round((i / histogram.length) * (FLASH_POOL.max + 1));
            const binMax = Math.round(((i + 1) / histogram.length) * (FLASH_POOL.max + 1));
            const isMine = guess >= binMin && guess < binMax;
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${Math.max(2, (v / maxBar) * 100)}%`,
                  background: isMine ? C.ink : C.hair,
                  borderRadius: "1px 1px 0 0",
                }}
              />
            );
          })}
        </div>

        {settled ? (
          <SettledView pool={pool} mine={mine} />
        ) : mine ? (
          <div style={{ fontSize: 12, color: C.ink2, lineHeight: 1.6 }}>
            You called <b style={num}>{mine.guess} min</b> for{" "}
            <b style={num}>{toUsdc(mine.stake).toFixed(0)} USDC</b>. One entry per wallet per
            pool — this one is in.
          </div>
        ) : locked ? (
          <div style={{ fontSize: 12, color: C.muted }}>Entries closed. Watching.</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ ...num, fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{guess}</span>
              <span style={{ fontSize: 12, color: C.muted }}>minutes drawn</span>
            </div>
            <input
              type="range"
              min={FLASH_POOL.min}
              max={FLASH_POOL.max}
              step={1}
              value={guess}
              onChange={(e) => setGuess(Number(e.target.value))}
              style={{ width: "100%", accentColor: C.ink }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: C.faint, marginTop: -6 }}>
              <span style={num}>{FLASH_POOL.min}&apos;</span>
              <span style={num}>{FLASH_POOL.max}&apos;</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 11.5, color: C.muted, flex: 1 }}>Stake</span>
              <input
                type="number"
                min={MIN_STAKE}
                max={MAX_STAKE}
                value={stake}
                onChange={(e) =>
                  setStake(Math.min(MAX_STAKE, Math.max(MIN_STAKE, Number(e.target.value) || MIN_STAKE)))
                }
                style={{
                  ...num,
                  width: 68,
                  border: `1px solid ${C.line}`,
                  borderRadius: 6,
                  padding: "6px 8px",
                  fontSize: 13,
                  fontWeight: 700,
                  textAlign: "right",
                }}
              />
              <span style={{ fontSize: 11, color: C.muted }}>USDC</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span style={{ color: C.muted }}>If exact</span>
              <span style={{ ...num, fontWeight: 800 }}>{toUsdc(projected).toFixed(2)} USDC</span>
            </div>

            <button
              onClick={place}
              disabled={busy}
              style={{
                border: "none",
                borderRadius: 8,
                padding: "11px 14px",
                fontSize: 13,
                fontWeight: 700,
                background: busy ? C.line2 : C.ink,
                color: busy ? C.faint : C.white,
                cursor: busy ? "default" : "pointer",
              }}
            >
              {busy ? "Confirming…" : connected ? `Call ${guess} min · ${stake} USDC` : "Connect Wallet"}
            </button>
          </>
        )}

        {settled && mine && !mine.claimed && (
          <button
            onClick={claim}
            disabled={busy}
            style={{
              border: "none",
              borderRadius: 8,
              padding: "11px 14px",
              fontSize: 13,
              fontWeight: 700,
              background: C.ink,
              color: C.white,
            }}
          >
            {busy ? "Confirming…" : "Claim"}
          </button>
        )}

        {status && (
          <div
            style={{
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
                  tx ↗
                </a>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SettledView({
  pool,
  mine,
}: {
  pool: OnChainPool;
  mine: { guess: number; stake: number; claimed: boolean } | null;
}) {
  const res = useMemo(
    () =>
      computePayouts(
        pool.entries.map((e) => ({ guess: e.guess, stake: BigInt(e.stake) })),
        pool.actual,
      ),
    [pool],
  );
  const idx = mine ? pool.entries.findIndex((e) => e.guess === mine.guess && e.stake === mine.stake) : -1;
  const row = idx >= 0 ? res.entries[idx] : null;

  return (
    <div style={{ fontSize: 12, color: C.ink2, lineHeight: 1.7 }}>
      The match was a draw for <b style={{ ...num, color: C.ink }}>{pool.actual} minutes</b>.
      {row && (
        <>
          {" "}
          You called <b style={num}>{row.guess}</b> — off by <b style={num}>{row.error}</b>,{" "}
          {row.isWinner ? (
            <>
              inside the median of {res.medianError}:{" "}
              <b style={{ ...num, color: C.ink }}>{toUsdc(row.payout).toFixed(2)} USDC</b>
              {mine?.claimed ? " (claimed)" : ""}
            </>
          ) : (
            <>outside the median of {res.medianError}. No payout.</>
          )}
        </>
      )}
    </div>
  );
}

function humanError(e: unknown): string {
  let s = e instanceof Error ? e.message : String(e);
  const logs = (e as { logs?: string[] })?.logs;
  if (logs?.length) s += " " + logs.join(" ");
  if (/User rejected/i.test(s)) return "Wallet rejected the transaction.";
  if (/PoolLocked/.test(s)) return "Entries just closed.";
  if (/AlreadyEntered/.test(s)) return "This wallet already called this market.";
  if (/AccountNotInitialized|could not find account/i.test(s))
    return "No USDC yet — get some at /mint.";
  if (/insufficient funds|InsufficientFunds/i.test(s)) return "Not enough USDC — get more at /mint.";
  const m = /Error Message: ([^.]+)/.exec(s);
  return m ? m[1]! : s.slice(0, 140);
}
