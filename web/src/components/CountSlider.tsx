"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import type { Entry, Pool } from "@/lib/types";
import { crowdHistogram, previewPayout, potUsdt } from "@/lib/payoutPreview";
import { usdt } from "@/lib/format";
import { Pill } from "@/components/ui";

const STAKE_PRESETS = [1, 5, 10, 25];

export function CountSlider({
  pool,
  crowd,
  actual,
  settled,
}: {
  pool: Pool;
  crowd: Entry[];
  actual?: number;
  settled?: boolean;
}) {
  const [guess, setGuess] = useState(() => Math.round((pool.sliderMin + pool.sliderMax) / 2));
  const [stake, setStake] = useState(5);

  const hist = useMemo(
    () => crowdHistogram(crowd, pool.sliderMin, pool.sliderMax),
    [crowd, pool.sliderMin, pool.sliderMax],
  );
  const maxStake = Math.max(1, ...hist.map((h) => h.stake));
  const preview = useMemo(
    () => previewPayout(crowd, guess, stake),
    [crowd, guess, stake],
  );

  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold tracking-tight">{pool.title}</div>
          <div className="text-xs text-muted">{pool.subtitle}</div>
        </div>
        <Pill tone={pool.settlePhase === 3 ? "money" : "pitch"}>
          {pool.settlePhase === 3 ? "settles HT" : "settles FT"}
        </Pill>
      </div>

      {/* histogram */}
      <div className="mt-4 flex h-24 items-end gap-[3px]">
        {hist.map((h) => {
          const isPick = h.value === guess;
          const isActual = settled && actual === h.value;
          return (
            <button
              key={h.value}
              type="button"
              onClick={() => !settled && setGuess(h.value)}
              className="group relative flex flex-1 flex-col items-center justify-end"
              title={`${h.value}: ${h.count} entries · ${usdt(h.stake)} USDT`}
            >
              <div
                className={clsx(
                  "w-full rounded-t transition-all",
                  isActual
                    ? "bg-pitch"
                    : isPick
                      ? "bg-money"
                      : "bg-pitch/25 group-hover:bg-pitch/40",
                )}
                style={{ height: `${Math.max(4, (h.stake / maxStake) * 100)}%` }}
              />
              <span
                className={clsx(
                  "num mt-1 text-[10px]",
                  isActual ? "text-pitch" : isPick ? "text-money" : "text-muted",
                )}
              >
                {h.value}
              </span>
            </button>
          );
        })}
      </div>

      {/* slider */}
      {!settled && (
        <input
          type="range"
          min={pool.sliderMin}
          max={pool.sliderMax}
          value={guess}
          onChange={(e) => setGuess(Number(e.target.value))}
          className="mt-3 w-full accent-money"
          aria-label={`${pool.title} guess`}
        />
      )}

      {/* readout + payout preview */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-line bg-panel-2 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted">Your guess</div>
          <div className="num text-2xl font-semibold text-money">{guess}</div>
        </div>
        <div className="rounded-lg border border-line bg-panel-2 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted">
            If it lands exactly here
          </div>
          <div className="num text-2xl font-semibold text-pitch">
            ≈ {usdt(preview.payoutUsdt, { decimals: 1 })}
            <span className="ml-1 text-sm text-muted">USDT</span>
          </div>
          <div className="num text-[11px] text-muted">
            {preview.multiple.toFixed(2)}× your stake · pot {usdt(potUsdt(crowd) + stake)} USDT
          </div>
        </div>
      </div>

      {/* stake */}
      {!settled && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Stake</span>
          {STAKE_PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStake(s)}
              className={clsx(
                "num rounded-md border px-2.5 py-1 text-sm transition",
                stake === s
                  ? "border-money bg-money/15 text-money"
                  : "border-line text-muted hover:text-ink",
              )}
            >
              {s}
            </button>
          ))}
          <div className="w-full sm:ml-auto sm:w-auto">
            <button
              type="button"
              className="w-full rounded-lg bg-pitch px-4 py-1.5 text-sm font-semibold text-bg shadow-glow transition hover:brightness-110 sm:w-auto"
            >
              Stake {usdt(stake)} → guess {guess}
            </button>
          </div>
        </div>
      )}

      {settled && actual != null && (
        <div className="mt-4 rounded-lg border border-pitch/40 bg-pitch/10 p-3 text-sm">
          Settled: actual was <span className="num font-semibold text-pitch">{actual}</span>. Winners
          were entries within the median error.
        </div>
      )}
    </div>
  );
}
