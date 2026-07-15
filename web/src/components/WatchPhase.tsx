"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { UnifiedTimeline } from "@/components/timeline/UnifiedTimeline";
import { Pill } from "@/components/ui";
import { ACTUALS, CROWD, FIXTURE, LIVE_EVENTS, POOLS } from "@/lib/mockData";
import { crowdHistogram } from "@/lib/payoutPreview";
import { NEVER_BUCKET, PHASE, type LiveEvent, type Pool } from "@/lib/types";

/**
 * The live watch view (README §5.4 item 3). A sweeping match clock advances the
 * whole match at a chosen speed. As the clock passes each LIVE_EVENT the stat
 * ticker updates, true-event pins appear on the WHEN timeline, and each COUNT
 * pool's actual-value needle crawls toward its final value.
 *
 * SSR-safe: the clock is plain component state seeded from `startMinute`; the
 * timer only ever runs inside useEffect, so the first client render matches SSR.
 */

const FULL_TIME = 90;
const TICK_MS = 120;

const WHEN_POOLS = POOLS.filter((p) => p.kind === "WHEN");
const COUNT_POOLS = POOLS.filter((p) => p.kind === "COUNT");

const FIRST_GOAL = LIVE_EVENTS.find((e) => e.kind === "goal");
const FIRST_CORNER = LIVE_EVENTS.find((e) => e.kind === "corner");
const FIRST_YELLOW = LIVE_EVENTS.find((e) => e.kind === "yellow");

/** Judges' pre-placed WHEN markers (close, but not exact — so settlement bites). */
const JUDGE_PLACEMENTS: Record<string, number | null> = {
  "when-1st-goal": 5,
  "when-1st-corner": 3,
  "when-1st-yellow": 9,
  "when-1st-red": NEVER_BUCKET,
};

interface Tally {
  goals: { home: number; away: number };
  corners: { home: number; away: number };
  cards: { home: number; away: number };
  latest: LiveEvent | null;
}

function tally(clock: number): Tally {
  const t: Tally = {
    goals: { home: 0, away: 0 },
    corners: { home: 0, away: 0 },
    cards: { home: 0, away: 0 },
    latest: null,
  };
  for (const e of LIVE_EVENTS) {
    if (e.minute > clock) continue;
    t.latest = e;
    if (e.kind === "goal") t.goals[e.team] += 1;
    else if (e.kind === "corner") t.corners[e.team] += 1;
    else t.cards[e.team] += 1; // yellow | red
  }
  return t;
}

/** Live value for a COUNT pool's needle — lands exactly on ACTUALS at settlement. */
function liveValueFor(pool: Pool, clock: number): number {
  const target = ACTUALS[pool.id] ?? 0;
  if (pool.id === "goals-total") {
    return LIVE_EVENTS.filter((e) => e.kind === "goal" && e.minute <= clock).length;
  }
  if (pool.id === "fh-goals") {
    const cap = Math.min(clock, 45);
    return LIVE_EVENTS.filter((e) => e.kind === "goal" && e.minute <= cap).length;
  }
  // Continuous stats (corners) ease toward their settled value.
  const settleMin = pool.settlePhase === PHASE.HT ? 45 : FULL_TIME;
  return target * Math.min(1, clock / settleMin);
}

function phaseLabel(clock: number): { label: string; tone: "muted" | "pitch" | "money" } {
  if (clock >= FULL_TIME) return { label: "FULL TIME", tone: "pitch" };
  if (clock >= 45) return { label: "2ND HALF", tone: "money" };
  if (clock < 1) return { label: "KICK-OFF", tone: "pitch" };
  return { label: "1ST HALF", tone: "money" };
}

export interface WatchPhaseProps {
  autoPlay?: boolean;
  /** minutes of match time simulated per real second. */
  speedMinPerSec?: number;
  onReachFullTime?: () => void;
  startMinute?: number;
}

export function WatchPhase({
  autoPlay = false,
  speedMinPerSec = 6,
  onReachFullTime,
  startMinute = 0,
}: WatchPhaseProps) {
  const [clock, setClock] = useState(startMinute);
  const [playing, setPlaying] = useState(autoPlay);
  const firedRef = useRef(false);

  // Ticking timer — client-only, so no hydration mismatch.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setClock((c) => Math.min(FULL_TIME, c + speedMinPerSec * (TICK_MS / 1000)));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, speedMinPerSec]);

  // Full-time edge — fire the callback exactly once.
  useEffect(() => {
    if (clock >= FULL_TIME && !firedRef.current) {
      firedRef.current = true;
      setPlaying(false);
      onReachFullTime?.();
    }
  }, [clock, onReachFullTime]);

  const t = useMemo(() => tally(clock), [clock]);
  const ph = phaseLabel(clock);
  const atFullTime = clock >= FULL_TIME;

  const revealedActuals = useMemo(() => {
    const a: Record<string, number> = {};
    if (FIRST_GOAL && clock >= FIRST_GOAL.minute) a["when-1st-goal"] = FIRST_GOAL.bucket;
    if (FIRST_CORNER && clock >= FIRST_CORNER.minute) a["when-1st-corner"] = FIRST_CORNER.bucket;
    if (FIRST_YELLOW && clock >= FIRST_YELLOW.minute) a["when-1st-yellow"] = FIRST_YELLOW.bucket;
    if (clock >= FULL_TIME) a["when-1st-red"] = ACTUALS["when-1st-red"]!;
    return a;
  }, [clock]);

  const togglePlay = () => {
    if (atFullTime) {
      firedRef.current = false;
      setClock(0);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  };

  return (
    <div className="space-y-4">
      {/* transport + clock */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-panel p-4">
        <button
          type="button"
          onClick={togglePlay}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-pitch text-lg text-bg shadow-glow transition hover:brightness-110"
          aria-label={playing ? "pause" : "play"}
        >
          {playing ? "❚❚" : atFullTime ? "↻" : "▶"}
        </button>

        <div className="flex items-baseline gap-2">
          <span className="num text-4xl font-semibold tabular-nums text-ink">
            {Math.floor(clock)}
            <span className="text-money">&apos;</span>
          </span>
          <Pill tone={ph.tone}>{ph.label}</Pill>
        </div>

        {/* score */}
        <div className="flex items-center gap-3 rounded-lg border border-line bg-panel-2 px-4 py-2">
          <span className="text-sm font-semibold text-home">{FIXTURE.p1Code}</span>
          <span className="num text-2xl font-semibold text-ink">
            {t.goals.home}
            <span className="mx-1 text-muted">–</span>
            {t.goals.away}
          </span>
          <span className="text-sm font-semibold text-away">{FIXTURE.p2Code}</span>
        </div>

        {/* scrubber */}
        <div className="ml-auto flex min-w-[220px] flex-1 items-center gap-3">
          <span className="num text-[11px] text-muted">0&apos;</span>
          <input
            type="range"
            min={0}
            max={FULL_TIME}
            step={0.5}
            value={clock}
            onChange={(e) => {
              setPlaying(false);
              setClock(Number(e.target.value));
            }}
            className="w-full accent-money"
            aria-label="scrub match clock"
          />
          <span className="num text-[11px] text-muted">90&apos;</span>
        </div>
      </div>

      {/* live stat ticker */}
      <div className="grid grid-cols-3 items-center gap-3 rounded-xl border border-line bg-panel p-4">
        <TeamStats
          side="home"
          name={FIXTURE.participant1}
          goals={t.goals.home}
          corners={t.corners.home}
          cards={t.cards.home}
        />
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-widest text-muted">live feed</div>
          <div className="num mt-0.5 truncate text-[11px] text-pitch" title={t.latest?.label}>
            {t.latest ? t.latest.label : "awaiting first event…"}
          </div>
        </div>
        <TeamStats
          side="away"
          name={FIXTURE.participant2}
          goals={t.goals.away}
          corners={t.corners.away}
          cards={t.cards.away}
          alignRight
        />
      </div>

      {/* WHEN timeline in watch mode */}
      <div className="rounded-xl border border-line bg-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            One timeline · clock sweeping every prediction
          </div>
          <Pill tone="money">pins drop as events happen</Pill>
        </div>
        <UnifiedTimeline
          pools={WHEN_POOLS}
          crowd={CROWD}
          placements={JUDGE_PLACEMENTS}
          mode="watch"
          clockMinute={clock}
          actuals={revealedActuals}
        />
      </div>

      {/* COUNT needles */}
      <div className="grid gap-3 lg:grid-cols-3">
        {COUNT_POOLS.map((pool) => (
          <LiveCountRow key={pool.id} pool={pool} value={liveValueFor(pool, clock)} settled={atFullTime} />
        ))}
      </div>
    </div>
  );
}

function TeamStats({
  side,
  name,
  goals,
  corners,
  cards,
  alignRight,
}: {
  side: "home" | "away";
  name: string;
  goals: number;
  corners: number;
  cards: number;
  alignRight?: boolean;
}) {
  const color = side === "home" ? "text-home" : "text-away";
  return (
    <div className={clsx(alignRight && "text-right")}>
      <div className={clsx("truncate text-sm font-semibold", color)}>{name}</div>
      <div
        className={clsx(
          "mt-1 flex gap-3 text-[11px] text-muted",
          alignRight && "justify-end",
        )}
      >
        <span className="num">⚽ {goals}</span>
        <span className="num">🚩 {corners}</span>
        <span className="num">🟨 {cards}</span>
      </div>
    </div>
  );
}

function LiveCountRow({
  pool,
  value,
  settled,
}: {
  pool: Pool;
  value: number;
  settled: boolean;
}) {
  const hist = crowdHistogram(CROWD[pool.id] ?? [], pool.sliderMin, pool.sliderMax);
  const maxStake = Math.max(1, ...hist.map((h) => h.stake));
  const span = pool.sliderMax - pool.sliderMin + 1;
  const needleFrac = ((value - pool.sliderMin + 0.5) / span) * 100;

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold tracking-tight">{pool.title}</div>
          <div className="text-[11px] text-muted">crowd vs live value</div>
        </div>
        <Pill tone={settled ? "pitch" : "money"}>
          {settled ? "settled" : "live"} {value.toFixed(pool.id === "corners-total" && !settled ? 1 : 0)}
        </Pill>
      </div>

      <div className="relative mt-4 h-16">
        {/* bars */}
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {hist.map((h) => {
            const near = settled && Math.abs(h.value - value) < 0.5;
            return (
              <div
                key={h.value}
                className={clsx(
                  "flex-1 rounded-t transition-colors",
                  near ? "bg-pitch" : "bg-pitch/20",
                )}
                style={{ height: `${Math.max(6, (h.stake / maxStake) * 100)}%` }}
                title={`${h.value}: ${h.count} in`}
              />
            );
          })}
        </div>
        {/* crawling needle */}
        <div
          className="absolute top-0 z-10 h-full w-0.5 bg-money shadow-glow transition-[left] duration-100"
          style={{ left: `${Math.min(100, Math.max(0, needleFrac))}%` }}
        >
          <div className="num absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-money px-1 text-[9px] font-bold text-bg">
            {value.toFixed(pool.id === "corners-total" && !settled ? 1 : 0)}
          </div>
        </div>
      </div>
      <div className="num mt-1 flex justify-between text-[10px] text-muted">
        <span>{pool.sliderMin}</span>
        <span>{pool.sliderMax}</span>
      </div>
    </div>
  );
}
