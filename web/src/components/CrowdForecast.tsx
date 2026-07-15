"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import type { Entry, Pool } from "@/lib/types";
import { BEYOND_BUCKET, NEVER_BUCKET } from "@/lib/types";
import { crowdHistogram, potUsdt } from "@/lib/payoutPreview";
import { bucketLabel, usdt } from "@/lib/format";
import { Pill } from "@/components/ui";

/**
 * Crowd Forecast (README §5.4 · 4b) — reads a pool's staked entries as a
 * crowd-sourced probability distribution and renders it as an elegant inline
 * chart plus a plain-language summary. Every stake is a weighted vote, so the
 * app becomes a *data producer*: a live consensus forecast that can be exported
 * and eventually placed side-by-side with TxLINE's own consensus odds.
 */

type Weighting = "stake" | "count";

interface Bin {
  value: number;
  count: number;
  stake: number;
}

const ACCENTS = {
  pitch: "#147A46",
  money: "#9A5B00",
} as const;

function weightOf(b: Bin, mode: Weighting): number {
  return mode === "stake" ? b.stake : b.count;
}

/** Smallest value whose cumulative weight fraction reaches `p` (weighted quantile). */
function weightedQuantile(bins: Bin[], mode: Weighting, p: number): number {
  const total = bins.reduce((s, b) => s + weightOf(b, mode), 0);
  if (total <= 0) return bins[0]?.value ?? 0;
  const target = p * total;
  let cum = 0;
  let val = bins[0]?.value ?? 0;
  for (const b of bins) {
    val = b.value;
    cum += weightOf(b, mode);
    if (cum >= target) break;
  }
  return val;
}

/** Catmull-Rom → cubic Bézier so the density reads as a smooth curve. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0]![0]} ${pts[0]![1]}`;
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/** Last word of a COUNT title → "goals" / "corners". */
function countNoun(pool: Pool): string {
  const words = pool.title.toLowerCase().trim().split(/\s+/);
  return words[words.length - 1] ?? "events";
}

/** Whatever follows "1st"/"first" in a WHEN title → "goal" / "yellow card". */
function whenSubject(pool: Pool): string {
  const m = pool.title.match(/(?:1st|first)\s+(.+)$/i);
  return (m?.[1] ?? "event").trim();
}

function pct(x: number): number {
  return Math.round(x * 100);
}

export function CrowdForecast({ pool, crowd }: { pool: Pool; crowd: Entry[] }) {
  const [mode, setMode] = useState<Weighting>("stake");
  const isWhen = pool.kind === "WHEN";
  const accent = isWhen ? ACCENTS.money : ACCENTS.pitch;
  const gradId = `cf-grad-${pool.id}`;

  const model = useMemo(() => {
    const raw = crowdHistogram(
      crowd,
      isWhen ? 0 : pool.sliderMin,
      isWhen ? NEVER_BUCKET : pool.sliderMax,
    );
    const never = isWhen ? raw.find((b) => b.value === NEVER_BUCKET) ?? null : null;
    // WHEN charts the temporal buckets (0–90'+); NEVER is categorical, shown apart.
    const bins = isWhen ? raw.filter((b) => b.value <= BEYOND_BUCKET) : raw;

    const totalW = bins.reduce((s, b) => s + weightOf(b, mode), 0);
    const neverW = never ? weightOf(never, mode) : 0;
    const grandW = totalW + neverW;
    const maxW = Math.max(1, ...bins.map((b) => weightOf(b, mode)));

    let modalIdx = 0;
    bins.forEach((b, i) => {
      if (weightOf(b, mode) > weightOf(bins[modalIdx]!, mode)) modalIdx = i;
    });
    const modal = bins[modalIdx]?.value ?? pool.sliderMin;
    const q25 = weightedQuantile(bins, mode, 0.25);
    const q75 = weightedQuantile(bins, mode, 0.75);

    return {
      bins,
      never,
      neverW,
      maxW,
      neverShare: grandW > 0 ? neverW / grandW : 0,
      modal,
      q25,
      q75,
      pot: potUsdt(crowd),
      entries: crowd.length,
    };
  }, [crowd, isWhen, mode, pool.id, pool.sliderMin, pool.sliderMax]);

  const { bins, maxW } = model;
  const n = bins.length;
  const HEAD = 84; // vertical headroom in viewBox units

  const barH = (b: Bin) => (weightOf(b, mode) / maxW) * HEAD;
  const curvePts: [number, number][] = bins.map((b, i) => [i + 0.5, 100 - barH(b)]);
  const idxLow = Math.max(0, bins.findIndex((b) => b.value === model.q25));
  const idxHigh = Math.max(idxLow, bins.findIndex((b) => b.value === model.q75));

  const areaPath =
    n > 0
      ? `${smoothPath(curvePts)} L ${curvePts[n - 1]![0]} 100 L ${curvePts[0]![0]} 100 Z`
      : "";

  // Axis tick predicate.
  const showTick = (value: number, i: number) =>
    isWhen ? value % 3 === 0 || value === BEYOND_BUCKET : n <= 16 || i % 2 === 0;
  const tickLabel = (value: number) =>
    isWhen ? (value === BEYOND_BUCKET ? "90+" : `${value * 5}`) : `${value}`;

  // Summary sentence + headline figures.
  const spread =
    model.q25 === model.q75
      ? isWhen
        ? bucketLabel(model.q25)
        : `${model.q25}`
      : isWhen
        ? `${model.q25 * 5}'–${model.q75 >= BEYOND_BUCKET ? "90'+" : `${model.q75 * 5 + 5}'`}`
        : `${model.q25}–${model.q75}`;

  const consensus = isWhen ? bucketLabel(model.modal) : `${model.modal}`;
  const summary = isWhen
    ? `First ${whenSubject(pool)} most likely in the ${bucketLabel(model.modal)} window`
    : model.q25 === model.q75
      ? `The crowd expects ${model.q25} ${countNoun(pool)}`
      : `The crowd expects ${model.q25}–${model.q75} ${countNoun(pool)}`;

  if (model.entries === 0) {
    return (
      <div className="rounded-xl border border-line bg-panel p-5">
        <div className="font-semibold tracking-tight">{pool.title}</div>
        <div className="mt-6 text-sm text-muted">No entries yet — the forecast fills in as the crowd stakes.</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-line bg-panel p-5">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold tracking-tight">{pool.title}</div>
          <div className="truncate text-xs text-muted">{pool.subtitle}</div>
        </div>
        <Pill tone={isWhen ? "money" : "pitch"}>
          {pool.marker ? `${pool.marker} ` : ""}
          {pool.kind}
        </Pill>
      </div>

      {/* summary sentence + weighting toggle */}
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="text-[15px] font-medium leading-snug text-ink">
          {summary}
          <span className="text-muted">.</span>
        </div>
        <div className="flex shrink-0 overflow-hidden rounded-md border border-line text-[10px]">
          {(["stake", "count"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={clsx(
                "px-2 py-1 font-medium transition",
                mode === m ? "bg-panel-2 text-ink" : "text-muted hover:text-ink",
              )}
            >
              {m === "stake" ? "USDT" : "votes"}
            </button>
          ))}
        </div>
      </div>

      {/* chart */}
      <div className="mt-4 flex items-stretch gap-2">
        <div className="min-w-0 flex-1">
          <div className="relative h-40">
            <svg
              className="h-full w-full"
              viewBox={`0 0 ${Math.max(1, n)} 100`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`${pool.title} crowd distribution`}
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accent} stopOpacity={0.24} />
                  <stop offset="100%" stopColor={accent} stopOpacity={0} />
                </linearGradient>
              </defs>

              {/* interquartile band */}
              {idxLow >= 0 && idxHigh >= idxLow && (
                <rect
                  x={idxLow}
                  y={0}
                  width={idxHigh - idxLow + 1}
                  height={100}
                  fill={accent}
                  fillOpacity={0.08}
                />
              )}

              {/* density area + curve */}
              {areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}
              {n > 1 && (
                <path
                  d={smoothPath(curvePts)}
                  fill="none"
                  stroke={accent}
                  strokeWidth={1.5}
                  strokeOpacity={0.85}
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {/* bars */}
              {bins.map((b, i) => {
                const h = barH(b);
                const inIqr = b.value >= model.q25 && b.value <= model.q75;
                const isModal = b.value === model.modal;
                return (
                  <g key={b.value}>
                    {h > 0 && (
                      <rect
                        x={i + 0.16}
                        y={100 - h}
                        width={0.68}
                        height={h}
                        fill={accent}
                        fillOpacity={isModal ? 1 : inIqr ? 0.5 : 0.22}
                      />
                    )}
                    {/* hover target for the whole column */}
                    <rect x={i} y={0} width={1} height={100} fill="transparent">
                      <title>
                        {isWhen ? bucketLabel(b.value) : b.value} · {b.count}{" "}
                        {b.count === 1 ? "entry" : "entries"} · {usdt(b.stake)} USDT
                      </title>
                    </rect>
                  </g>
                );
              })}

              {/* baseline */}
              <line x1={0} y1={100} x2={n} y2={100} stroke={accent} strokeOpacity={0.18} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </svg>
          </div>

          {/* axis */}
          <div className="mt-1 flex">
            {bins.map((b, i) => (
              <div key={b.value} className="min-w-0 flex-1 text-center">
                {showTick(b.value, i) && (
                  <span
                    className={clsx(
                      "num text-[9px]",
                      b.value === model.modal ? "font-semibold text-ink" : "text-muted",
                    )}
                  >
                    {tickLabel(b.value)}
                  </span>
                )}
              </div>
            ))}
          </div>
          {isWhen && <div className="mt-0.5 text-center text-[9px] uppercase tracking-wide text-muted/70">match minute</div>}
        </div>

        {/* NEVER column (WHEN only) */}
        {isWhen && (
          <div className="flex flex-col items-center border-l border-dashed border-line pl-2">
            <div className="relative flex h-40 w-8 items-end justify-center">
              <div
                className="w-3.5 rounded-t bg-muted/40"
                style={{ height: `${Math.min(100, (model.neverW / maxW) * HEAD)}%` }}
                title={`Never: ${pct(model.neverShare)}%`}
              />
            </div>
            <div className="num mt-1 text-[10px] font-semibold text-muted">{pct(model.neverShare)}%</div>
            <div className="text-[9px] uppercase tracking-wide text-muted/70">never</div>
          </div>
        )}
      </div>

      {/* headline stats */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat label="Crowd call" value={consensus} accent />
        <MiniStat label="Middle 50%" value={spread} />
        <MiniStat label="Pot" value={`${usdt(model.pot)}`} unit="USDT" />
        <MiniStat label="Votes" value={`${model.entries}`} />
      </div>

      {/* consensus compare (spacer pushes it to the card bottom in a grid) */}
      <div className="mt-4 flex-1" />
      <ConsensusCompare crowdLabel={consensus} accent={accent} />
    </div>
  );
}

function MiniStat({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={clsx("num text-sm font-semibold", accent ? "text-money" : "text-ink")}>
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-muted">{unit}</span>}
      </div>
    </div>
  );
}

/**
 * Where TxLINE's own consensus odds land next to the crowd's view. The crowd
 * side is live; the TxLINE side is a wired-in placeholder so the intent — a
 * direct crowd-vs-book comparison — is explicit for reviewers.
 */
export function ConsensusCompare({
  crowdLabel,
  accent = ACCENTS.pitch,
}: {
  crowdLabel: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Consensus compare
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-md border px-3 py-2" style={{ borderColor: `${accent}55` }}>
          <div className="text-[10px] uppercase tracking-wide text-muted">Crowd</div>
          <div className="num font-semibold" style={{ color: accent }}>
            {crowdLabel}
          </div>
        </div>
        <div className="rounded-md border border-dashed border-line px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted">TxLINE odds</div>
          <div className="num text-muted/70">— · —</div>
          <div className="mt-0.5 text-[10px] leading-tight text-muted/60">
            wire via <span className="num">/api/odds/snapshot</span>
          </div>
        </div>
      </div>
    </div>
  );
}
