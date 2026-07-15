"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { computePayouts, type EntryInput } from "@exact-match/payout";
import { ProofViewer } from "@/components/ProofViewer";
import { Pill } from "@/components/ui";
import { ACTUALS, CROWD, POOLS, toBaseUnits } from "@/lib/mockData";
import { bucketLabel, shortWallet, usdt } from "@/lib/format";
import { USDT_UNIT, type Entry, type Pool } from "@/lib/types";

/**
 * The settled state for a single pool (README §5.4 item 4, §2 demo beats). The
 * needle lands on the actual value, winners light up, the losers' pot is split
 * by the exact §5.3 median-error payout, and the TxLINE proof is embedded.
 *
 * The robbery beat: a viewer can try to force-settle with a forged value — the
 * (mocked) chain rejects it with the program's real error codes — before the
 * genuine proof flips the pool to settled.
 */

function fromBaseUnits(base: bigint): number {
  return Number(base) / USDT_UNIT;
}

interface WinnerRow {
  entry: Entry;
  error: number;
  weight: bigint;
  payout: bigint;
}

function useSettlement(pool: Pool, crowd: Entry[], actual: number) {
  return useMemo(() => {
    const inputs: EntryInput[] = crowd.map((e) => ({
      guess: e.guess,
      stake: toBaseUnits(e.stake),
    }));
    const res = computePayouts(inputs, actual);
    const winners: WinnerRow[] = crowd
      .map((entry, i) => {
        const r = res.entries[i]!;
        return { entry, error: r.error, weight: r.weight, payout: r.payout };
      })
      .filter((_, i) => res.entries[i]!.isWinner)
      .sort((a, b) => Number(b.payout - a.payout));
    const winnerCount = res.entries.filter((e) => e.isWinner).length;
    return { res, winners, winnerCount };
  }, [pool.id, crowd, actual]);
}

export function SettlementReceipt({ poolId }: { poolId: string }) {
  const pool = POOLS.find((p) => p.id === poolId);
  const crowd = CROWD[poolId] ?? [];
  const actual = ACTUALS[poolId] ?? 0;

  const [settled, setSettled] = useState(false);
  const [landed, setLanded] = useState(false);
  const [forge, setForge] = useState("");
  const [rejected, setRejected] = useState<number | null>(null);

  // Trigger the landing animation just after the pool flips to settled.
  useEffect(() => {
    if (!settled) return;
    const id = setTimeout(() => setLanded(true), 60);
    return () => clearTimeout(id);
  }, [settled]);

  const { res, winners, winnerCount } = useSettlement(
    pool ?? ({} as Pool),
    crowd,
    actual,
  );

  if (!pool) return null;

  const isWhen = pool.kind === "WHEN";
  const valueLabel = (v: number) => (isWhen ? bucketLabel(v) : String(v));
  const span = pool.sliderMax - pool.sliderMin + 1;
  const fracFor = (v: number) => ((v - pool.sliderMin + 0.5) / span) * 100;

  const forgeNum = Number(forge);
  const forgeValid = forge.trim() !== "" && Number.isFinite(forgeNum);

  const attemptForge = () => {
    if (!forgeValid) return;
    setRejected(forgeNum);
  };
  const submitReal = () => {
    setRejected(null);
    setSettled(true);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-card">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <div>
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            {pool.marker && <span>{pool.marker}</span>}
            {pool.title}
          </div>
          <div className="text-xs text-muted">{pool.subtitle}</div>
        </div>
        {settled ? (
          <Pill tone="pitch">SETTLED · {valueLabel(actual)}</Pill>
        ) : (
          <Pill tone="money">awaiting proof</Pill>
        )}
      </div>

      <div className="space-y-4 p-5">
        {/* outcome strip */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
            <span>crowd distribution</span>
            <span className="num">
              pot {usdt(fromBaseUnits(res.vault), { decimals: 0 })} USDT · {crowd.length} entries
            </span>
          </div>
          <div className="relative h-24 overflow-hidden rounded-lg border border-line bg-panel-2 px-1 pt-1">
            <div className="flex h-full items-end gap-[2px]">
              {(() => {
                const stakeByBin = Array.from({ length: span }, (_, i) =>
                  crowd
                    .filter((e) => e.guess === pool.sliderMin + i)
                    .reduce((s, e) => s + e.stake, 0),
                );
                const maxStake = Math.max(1, ...stakeByBin);
                return stakeByBin.map((stake, i) => {
                  const v = pool.sliderMin + i;
                  const isWinnerBin =
                    settled && Math.abs(v - actual) <= res.medianError;
                  const isActualBin = settled && v === actual;
                  return (
                  <div
                    key={v}
                    className={clsx(
                      "flex-1 rounded-t transition-colors duration-500",
                      isActualBin
                        ? "bg-pitch"
                        : isWinnerBin
                          ? "bg-pitch/45"
                          : "bg-pitch/15",
                    )}
                    style={{ height: `${Math.max(6, (stake / maxStake) * 90)}%` }}
                    title={`${valueLabel(v)} · ${usdt(stake)} USDT`}
                  />
                  );
                });
              })()}
            </div>

            {/* forged (robber's) needle */}
            {rejected != null && !settled && (
              <div
                className="absolute top-0 z-10 h-full w-0.5 bg-red-600"
                style={{ left: `${Math.min(100, Math.max(0, fracFor(rejected)))}%` }}
              >
                <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-red-600 px-1 text-[9px] font-bold text-white">
                  forged {valueLabel(rejected)} ✕
                </div>
              </div>
            )}

            {/* real settled needle */}
            {settled && (
              <div
                className="absolute top-0 z-20 h-full w-0.5 bg-money shadow-glow transition-[left] duration-700 ease-out"
                style={{ left: `${landed ? fracFor(actual) : 0}%` }}
              >
                <div className="num absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-money px-1 text-[9px] font-bold text-bg">
                  actual {valueLabel(actual)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ROBBERY BEAT — forge control, shown until the real proof settles */}
        {!settled && (
          <div className="rounded-lg border border-line bg-panel-2 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              Can you rob the pot?
            </div>
            <p className="mt-1 text-xs text-muted">
              Try to force-settle this pool with any value you like. There is no admin key — the
              program only accepts a value carried by a valid TxLINE Merkle proof.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="number"
                value={forge}
                onChange={(e) => {
                  setForge(e.target.value);
                  setRejected(null);
                }}
                placeholder="forged value"
                className="num w-32 rounded-md border border-line bg-bg px-2 py-1.5 text-sm text-ink outline-none focus:border-money"
              />
              <button
                type="button"
                onClick={attemptForge}
                disabled={!forgeValid}
                className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-40"
              >
                Force settle
              </button>
              <button
                type="button"
                onClick={submitReal}
                className="ml-auto rounded-lg bg-pitch px-4 py-1.5 text-sm font-semibold text-bg shadow-glow transition hover:brightness-110"
              >
                Submit the REAL proof →
              </button>
            </div>

            {rejected != null && (
              <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                <div className="flex items-center gap-2 font-semibold">
                  <span>⛔</span> Transaction reverted — the chain rejects the forgery
                </div>
                <ul className="num mt-1.5 space-y-0.5 text-[12px]">
                  <li>Error 6023 · InvalidStatProof — no Merkle path to the on-chain root</li>
                  <li>Error 6021 · PredicateFailed — {valueLabel(rejected)} does not satisfy the settled stat</li>
                </ul>
                <div className="mt-1.5 text-[11px] text-red-600">
                  Money stayed put. Only a valid proof moves the pot.
                </div>
              </div>
            )}
          </div>
        )}

        {/* SETTLED — payout split */}
        {settled && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Actual" value={valueLabel(actual)} tone="pitch" />
              <Metric label="Median error" value={String(res.medianError)} />
              <Metric
                label="Winners"
                value={`${winnerCount}/${crowd.length}`}
                tone="money"
              />
              <Metric
                label="Dust left in vault"
                value={`${usdt(fromBaseUnits(res.dust), { decimals: 4 })}`}
              />
            </div>

            <div className="rounded-lg border border-line bg-panel-2 p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Losers&apos; pot split — {usdt(fromBaseUnits(res.losersPot), { decimals: 0 })} USDT
                  across {winnerCount} winners
                </div>
                <span className="num text-[11px] text-muted">stake back + weighted share</span>
              </div>
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-1 text-[11px] text-muted">
                <span>predictor</span>
                <span className="text-right">error</span>
                <span className="text-right">weight</span>
                <span className="text-right">payout</span>
              </div>
              <div className="mt-1 space-y-1">
                {winners.slice(0, 6).map((w, i) => (
                  <div
                    key={w.entry.wallet}
                    className={clsx(
                      "grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 rounded-md bg-pitch/5 px-2 py-1.5 transition-all duration-500",
                      landed ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
                    )}
                    style={{ transitionDelay: `${120 + i * 70}ms` }}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span className="text-sm text-ink">@{w.entry.handle}</span>
                      <span className="num text-[10px] text-muted">
                        {shortWallet(w.entry.wallet)} · guessed {valueLabel(w.entry.guess)}
                      </span>
                    </span>
                    <span className="num text-right text-[12px] text-muted">{w.error}</span>
                    <span className="num text-right text-[12px] text-muted">
                      {(Number(w.weight) / 1_000_000).toFixed(1)}
                    </span>
                    <span className="num text-right text-[13px] font-semibold text-pitch">
                      {usdt(fromBaseUnits(w.payout), { decimals: 2 })}
                    </span>
                  </div>
                ))}
              </div>
              {winners.length > 6 && (
                <div className="num mt-1.5 text-[11px] text-muted">
                  + {winners.length - 6} more winners share the rest.
                </div>
              )}
            </div>

            <ProofViewer />
          </>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "pitch" | "money";
}) {
  const c = tone === "pitch" ? "text-pitch" : tone === "money" ? "text-money" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-panel-2 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={clsx("num mt-0.5 text-lg font-semibold", c)}>{value}</div>
    </div>
  );
}
