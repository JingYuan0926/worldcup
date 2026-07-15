"use client";

import { useState } from "react";
import clsx from "clsx";
import { UnifiedTimeline } from "@/components/timeline/UnifiedTimeline";
import { CountSlider } from "@/components/CountSlider";
import { WatchPhase } from "@/components/WatchPhase";
import { SettlementReceipt } from "@/components/SettlementReceipt";
import { Panel, Pill } from "@/components/ui";
import { CROWD, FIXTURE, POOLS } from "@/lib/mockData";
import { NEVER_BUCKET } from "@/lib/types";

/**
 * The Judges' replay room (README §5.4, §2 demo beats). It replays the recorded
 * quarterfinal against a pre-funded judges' pool and sequences the three demo
 * beats — ENTRY → WATCH → SETTLEMENT — self-driving but manually steppable.
 */

const STAGES = [
  { key: "entry", label: "Enter", hint: "paint the match" },
  { key: "watch", label: "Watch", hint: "clock sweeps live" },
  { key: "settle", label: "Settle", hint: "proof moves the pot" },
] as const;

const WHEN_POOLS = POOLS.filter((p) => p.kind === "WHEN");
const GOALS_POOL = POOLS.find((p) => p.id === "goals-total")!;

/** Judges' markers pre-placed for the replay. */
const START_PLACEMENTS: Record<string, number | null> = {
  "when-1st-goal": 5,
  "when-1st-corner": 3,
  "when-1st-yellow": 9,
  "when-1st-red": NEVER_BUCKET,
};

export default function ReplayPage() {
  const [stage, setStage] = useState(0);
  const [fullTime, setFullTime] = useState(false);
  const [placements, setPlacements] =
    useState<Record<string, number | null>>(START_PLACEMENTS);

  const go = (i: number) => {
    setStage(Math.max(0, Math.min(STAGES.length - 1, i)));
  };

  return (
    <div className="space-y-6">
      {/* header */}
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Pill tone="pitch">Judges&apos; replay room</Pill>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              {FIXTURE.participant1}{" "}
              <span className="text-muted">v</span> {FIXTURE.participant2} — full demo replay
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              The ingest replayer streams the <span className="text-ink">recorded quarterfinal</span>{" "}
              frames against a pre-funded judges&apos; pool, so the whole life-cycle runs on demand.
              Step through it below: enter the pools, watch the clock sweep the timeline, then settle.
            </p>
          </div>
          <div className="rounded-lg border border-money/30 bg-money/5 px-4 py-3 text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted">Trust model</div>
            <div className="mt-0.5 text-sm font-semibold text-money">
              No admin key — only a valid proof moves the pot
            </div>
          </div>
        </div>

        {/* stepper */}
        <div className="mt-5 grid grid-cols-3 gap-2">
          {STAGES.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => go(i)}
              className={clsx(
                "group flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition",
                i === stage
                  ? "border-pitch/50 bg-pitch/10"
                  : i < stage
                    ? "border-line bg-panel-2"
                    : "border-line bg-panel-2/40 hover:bg-panel-2",
              )}
            >
              <span
                className={clsx(
                  "num grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold",
                  i === stage
                    ? "bg-pitch text-bg"
                    : i < stage
                      ? "bg-pitch/20 text-pitch"
                      : "bg-panel text-muted",
                )}
              >
                {i < stage ? "✓" : i + 1}
              </span>
              <span className="min-w-0">
                <span
                  className={clsx(
                    "block text-sm font-semibold",
                    i === stage ? "text-ink" : "text-muted",
                  )}
                >
                  {s.label}
                </span>
                <span className="block truncate text-[11px] text-muted">{s.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Panel>

      {/* STAGE 1 — ENTRY */}
      {stage === 0 && (
        <div className="space-y-4">
          <Panel className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Stage 1 · Enter the pools
              </div>
              <Pill tone="money">judges&apos; markers pre-placed</Pill>
            </div>
            <UnifiedTimeline
              pools={WHEN_POOLS}
              crowd={CROWD}
              placements={placements}
              onPlace={(id, bucket) =>
                setPlacements((prev) => ({ ...prev, [id]: bucket }))
              }
            />
          </Panel>
          <CountSlider pool={GOALS_POOL} crowd={CROWD[GOALS_POOL.id] ?? []} />
          <StageNav onNext={() => go(1)} nextLabel="Start the watch →" />
        </div>
      )}

      {/* STAGE 2 — WATCH */}
      {stage === 1 && (
        <div className="space-y-4">
          <Panel className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Stage 2 · Watch it play out
              </div>
              <Pill tone={fullTime ? "pitch" : "money"}>
                {fullTime ? "full time" : "replaying QF"}
              </Pill>
            </div>
            <WatchPhase
              autoPlay
              speedMinPerSec={7}
              onReachFullTime={() => setFullTime(true)}
            />
          </Panel>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => go(0)}
              className="rounded-lg border border-line px-4 py-2 text-sm text-muted transition hover:text-ink"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => go(2)}
              className={clsx(
                "rounded-lg px-5 py-2 text-sm font-semibold shadow-glow transition",
                fullTime
                  ? "animate-pulseglow bg-pitch text-bg hover:brightness-110"
                  : "bg-panel-2 text-muted",
              )}
            >
              {fullTime ? "Settle the pools →" : "Settle (waiting for full time)…"}
            </button>
          </div>
        </div>
      )}

      {/* STAGE 3 — SETTLEMENT */}
      {stage === 2 && (
        <div className="space-y-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Stage 3 · Settle by proof — the halftime flash-pool and the first-goal window
          </div>
          <SettlementReceipt poolId="fh-goals" />
          <SettlementReceipt poolId="when-1st-goal" />
          <StageNav onBack={() => go(1)} onNext={() => go(0)} nextLabel="Replay from the top ↺" />
        </div>
      )}
    </div>
  );
}

function StageNav({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-line px-4 py-2 text-sm text-muted transition hover:text-ink"
        >
          ← Back
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onNext}
        className="rounded-lg bg-pitch px-5 py-2 text-sm font-semibold text-bg shadow-glow transition hover:brightness-110"
      >
        {nextLabel}
      </button>
    </div>
  );
}
