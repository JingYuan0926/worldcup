"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  BEYOND_BUCKET,
  NEVER_BUCKET,
  REGULATION_BUCKETS,
  type Entry,
  type Pool,
} from "@/lib/types";
import { bucketLabel } from "@/lib/format";

/**
 * Exact Match's signature input: one shared time axis, with independent event
 * predictions painted above and below it. Zoom only changes the size of the
 * five-minute targets; it never changes the settlement granularity.
 */

const MAIN_CELLS = BEYOND_BUCKET + 1; // 0..17 regulation + 18 (90'+)
const REGULATION_WIDTH = (REGULATION_BUCKETS / MAIN_CELLS) * 100;

const ROW: Record<
  string,
  { top: number; color: string; ring: string; heat: string; label: string }
> = {
  "🚩": {
    top: 19,
    color: "text-home",
    ring: "ring-home/70 bg-home/20",
    heat: "91, 168, 245",
    label: "Corner",
  },
  "⚽": {
    top: 49,
    color: "text-money",
    ring: "ring-money/80 bg-money/25",
    heat: "240, 180, 65",
    label: "Goal",
  },
  "🟨": {
    top: 68,
    color: "text-money",
    ring: "ring-money/60 bg-money/15",
    heat: "240, 180, 65",
    label: "Yellow",
  },
  "🟥": {
    top: 84,
    color: "text-away",
    ring: "ring-away/70 bg-away/20",
    heat: "231, 124, 147",
    label: "Red",
  },
};

const rowOf = (marker?: string) => ROW[marker ?? "⚽"] ?? ROW["⚽"]!;

interface DragState {
  poolId: string;
  from: "palette" | "marker";
  x: number;
  y: number;
}

export interface UnifiedTimelineProps {
  pools: Pool[];
  crowd: Record<string, Entry[]>;
  placements: Record<string, number | null>;
  onPlace?: (poolId: string, bucket: number | null) => void;
  mode?: "entry" | "watch" | "settled";
  /** Watch-mode match clock in minutes. */
  clockMinute?: number;
  /** Proven/revealed WHEN outcomes, keyed by pool id. */
  actuals?: Record<string, number>;
}

export function UnifiedTimeline({
  pools,
  crowd,
  placements,
  onPlace,
  mode = "entry",
  clockMinute,
  actuals,
}: UnifiedTimelineProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const neverRef = useRef<HTMLDivElement>(null);
  const defaultPoolId = pools.find((pool) => pool.marker === "⚽")?.id ?? pools[0]?.id ?? null;
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(defaultPoolId);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverPoolId, setHoverPoolId] = useState<string | null>(null);
  const [hoverBucket, setHoverBucket] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const editable = mode === "entry" && onPlace !== undefined;
  const activePoolId = drag?.poolId ?? hoverPoolId ?? selectedPoolId;
  const activePool = pools.find((pool) => pool.id === activePoolId) ?? pools[0] ?? null;

  useEffect(() => {
    if (selectedPoolId && pools.some((pool) => pool.id === selectedPoolId)) return;
    setSelectedPoolId(defaultPoolId);
  }, [defaultPoolId, pools, selectedPoolId]);

  const orderedPools = useMemo(
    () => [...pools].sort((a, b) => rowOf(a.marker).top - rowOf(b.marker).top),
    [pools],
  );

  const commitPlacement = useCallback(
    (poolId: string, bucket: number | null) => {
      if (!editable || !onPlace) return;
      onPlace(poolId, bucket);
      setSelectedPoolId(poolId);
      const pool = pools.find((item) => item.id === poolId);
      const name = pool ? shortTitle(pool.title) : "Event";
      setAnnouncement(bucket == null ? `${name} removed.` : `${name} placed at ${bucketLabel(bucket)}.`);
    },
    [editable, onPlace, pools],
  );

  /** Bucket (or NEVER, or null when outside every target) from a screen point. */
  const bucketFromPoint = useCallback((clientX: number, clientY: number): number | null => {
    const never = neverRef.current?.getBoundingClientRect();
    if (
      never &&
      clientX >= never.left &&
      clientX <= never.right &&
      clientY >= never.top &&
      clientY <= never.bottom
    ) {
      return NEVER_BUCKET;
    }

    const track = trackRef.current?.getBoundingClientRect();
    if (
      track &&
      clientX >= track.left &&
      clientX <= track.right &&
      clientY >= track.top - 24 &&
      clientY <= track.bottom + 24
    ) {
      const fraction = Math.min(1, Math.max(0, (clientX - track.left) / track.width));
      return Math.min(BEYOND_BUCKET, Math.floor(fraction * MAIN_CELLS));
    }
    return null;
  }, []);

  // Keep a zoomed canvas moving when a marker is dragged near either edge.
  const autoScroll = useCallback((clientX: number) => {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    const rect = scroller.getBoundingClientRect();
    const edge = Math.min(64, rect.width * 0.16);
    if (clientX < rect.left + edge) scroller.scrollBy({ left: -18 });
    else if (clientX > rect.right - edge) scroller.scrollBy({ left: 18 });
  }, []);

  // Capture the stable drag identity once, rather than rebinding on every ghost move.
  useEffect(() => {
    if (!drag) return;
    const { poolId } = drag;

    const move = (event: PointerEvent) => {
      autoScroll(event.clientX);
      setDrag((current) =>
        current ? { ...current, x: event.clientX, y: event.clientY } : current,
      );
      setHoverBucket(bucketFromPoint(event.clientX, event.clientY));
    };
    const finish = (event: PointerEvent) => {
      const bucket = bucketFromPoint(event.clientX, event.clientY);
      if (bucket != null) commitPlacement(poolId, bucket);
      setDrag(null);
      setHoverBucket(null);
    };
    const cancel = () => {
      setDrag(null);
      setHoverBucket(null);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", keydown);
    };
    // `drag` coordinates deliberately are not dependencies.
  }, [drag?.poolId, autoScroll, bucketFromPoint, commitPlacement]);

  const startDrag = (
    poolId: string,
    from: "palette" | "marker",
    event: React.PointerEvent,
  ) => {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedPoolId(poolId);
    setDrag({ poolId, from, x: event.clientX, y: event.clientY });
    setHoverBucket(bucketFromPoint(event.clientX, event.clientY));
  };

  const moveSelected = (direction: -1 | 1) => {
    if (!activePool) return;
    const current = placements[activePool.id];
    let next: number;
    if (current == null) next = 0;
    else if (direction < 0) next = current === NEVER_BUCKET ? BEYOND_BUCKET : Math.max(0, current - 1);
    else if (current === BEYOND_BUCKET) next = NEVER_BUCKET;
    else if (current === NEVER_BUCKET) next = NEVER_BUCKET;
    else next = Math.min(BEYOND_BUCKET, current + 1);
    commitPlacement(activePool.id, next);
  };

  const handleTrackKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!editable || !activePool) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSelected(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSelected(1);
    } else if (event.key === "Home") {
      event.preventDefault();
      commitPlacement(activePool.id, 0);
    } else if (event.key === "End" || event.key.toLowerCase() === "n") {
      event.preventDefault();
      commitPlacement(activePool.id, NEVER_BUCKET);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      commitPlacement(activePool.id, null);
    }
  };

  const density = useMemo(() => {
    if (!activePool) return null;
    const entries = crowd[activePool.id] ?? [];
    const buckets = new Array<number>(MAIN_CELLS).fill(0);
    let neverCount = 0;
    let neverStake = 0;
    for (const entry of entries) {
      if (entry.guess >= 0 && entry.guess < MAIN_CELLS) buckets[entry.guess] += 1;
      else if (entry.guess === NEVER_BUCKET) {
        neverCount += 1;
        neverStake += entry.stake;
      }
    }
    return {
      buckets,
      neverCount,
      neverStake,
      max: Math.max(1, neverCount, ...buckets),
      total: entries.length,
    };
  }, [activePool, crowd]);

  const ticks =
    zoom >= 2
      ? Array.from({ length: REGULATION_BUCKETS + 1 }, (_, index) => index * 5)
      : [0, 15, 30, 45, 60, 75, 90];
  const clockLeft =
    clockMinute == null
      ? null
      : (Math.min(REGULATION_BUCKETS, Math.max(0, clockMinute / 5)) / MAIN_CELLS) * 100;

  return (
    <div className="select-none">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {editable ? "Pick an event · drag or click a time" : "Select an event to inspect its crowd"}
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {orderedPools.map((pool) => {
              const selected = pool.id === activePool?.id;
              const placed = placements[pool.id] != null;
              const row = rowOf(pool.marker);
              return (
                <button
                  key={pool.id}
                  type="button"
                  onPointerDown={(event) => startDrag(pool.id, "palette", event)}
                  onClick={() => setSelectedPoolId(pool.id)}
                  onPointerEnter={() => setHoverPoolId(pool.id)}
                  onPointerLeave={() => setHoverPoolId((id) => (id === pool.id ? null : id))}
                  style={{ touchAction: editable ? "none" : "auto" }}
                  className={clsx(
                    "flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch",
                    editable && "cursor-grab active:cursor-grabbing",
                    selected
                      ? "border-pitch/60 bg-pitch/10 text-ink shadow-glow"
                      : "border-line bg-panel hover:border-pitch/40 hover:bg-panel-2",
                  )}
                  aria-pressed={pool.id === selectedPoolId}
                  aria-label={`${shortTitle(pool.title)}${placed ? `, placed at ${bucketLabel(placements[pool.id]!)}` : ", not placed"}`}
                >
                  <span className="text-lg leading-none" aria-hidden="true">{pool.marker}</span>
                  <span className={clsx("text-xs sm:text-sm", selected ? "text-ink" : "text-muted")}>
                    {row.label}
                  </span>
                  {placed && <span className="num text-[10px] text-pitch">{bucketLabel(placements[pool.id]!)}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 p-1 sm:w-auto sm:justify-start">
          <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Zoom</span>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
            className="grid h-9 w-9 place-items-center rounded-md text-lg text-ink transition hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch"
            aria-label="Zoom timeline out"
          >
            −
          </button>
          <input
            type="range"
            min={1}
            max={4}
            step={0.5}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-20 accent-pitch sm:w-28"
            aria-label="Timeline zoom"
            aria-valuetext={`${zoom} times`}
          />
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(4, value + 0.5))}
            className="grid h-9 w-9 place-items-center rounded-md text-lg text-ink transition hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch"
            aria-label="Zoom timeline in"
          >
            +
          </button>
          <span className="num mr-1 w-8 text-xs text-muted">{zoom}×</span>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span>
          Crowd heat · <span className={activePool ? rowOf(activePool.marker).color : "text-ink"}>{activePool ? shortTitle(activePool.title) : "event"}</span>
        </span>
        <span className="num">{density?.total ?? 0} predictions · brighter = more crowded</span>
      </div>

      <div className="flex items-stretch gap-2">
        <div
          ref={scrollerRef}
          className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden rounded-xl border border-line bg-panel-2"
        >
          <div
            ref={trackRef}
            role={editable ? "slider" : "group"}
            tabIndex={editable ? 0 : undefined}
            aria-describedby="timeline-help"
            aria-label={
              editable && activePool
                ? `${shortTitle(activePool.title)} time window. Click to place; use left and right arrows to adjust, N for never, or Delete to remove.`
                : "Unified match prediction timeline"
            }
            aria-valuemin={editable ? 0 : undefined}
            aria-valuemax={editable ? NEVER_BUCKET : undefined}
            aria-valuenow={editable && activePool ? (placements[activePool.id] ?? 0) : undefined}
            aria-valuetext={
              editable && activePool
                ? placements[activePool.id] == null
                  ? "Not placed"
                  : bucketLabel(placements[activePool.id]!)
                : undefined
            }
            onKeyDown={handleTrackKeyDown}
            onClick={(event) => {
              if (!editable || !activePool || drag) return;
              const bucket = bucketFromPoint(event.clientX, event.clientY);
              if (bucket != null && bucket !== NEVER_BUCKET) commitPlacement(activePool.id, bucket);
            }}
            className={clsx(
              "pitch-stripes relative h-44 min-w-full outline-none sm:h-48",
              editable && "cursor-crosshair focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pitch",
            )}
            style={{ width: `${zoom * 100}%` }}
          >
            {/* The final 1/19 cell is explicitly not regulation time. */}
            <div
              className="absolute inset-y-0 right-0 border-l border-dashed border-money/45 bg-money/[0.035]"
              style={{ width: `${100 / MAIN_CELLS}%` }}
            >
              <span className="num absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold text-money/80">
                90&apos;+
              </span>
            </div>

            {ticks.map((minute) => (
              <div
                key={minute}
                className="pointer-events-none absolute top-0 h-full"
                style={{ left: `${(minute / 5 / MAIN_CELLS) * 100}%` }}
              >
                <div className={clsx("h-full w-px", minute === 90 ? "bg-money/35" : "bg-line/60")} />
                <span
                  className={clsx(
                    "num absolute top-1 whitespace-nowrap text-[10px] text-muted",
                    minute === 0 ? "left-1" : minute === 90 ? "right-1" : "left-1",
                  )}
                >
                  {minute}&apos;
                </span>
              </div>
            ))}

            {/* Active pool density: a single heat strip, never a second time axis. */}
            {density && activePool && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-3">
                {density.buckets.map((count, index) => {
                  const strength = count === 0 ? 0.03 : 0.18 + (count / density.max) * 0.72;
                  return (
                    <div
                      key={index}
                      className="h-full flex-1 border-r border-bg/30"
                      style={{ backgroundColor: `rgba(${rowOf(activePool.marker).heat}, ${strength})` }}
                      title={`${bucketLabel(index)} · ${count} predictions`}
                    />
                  );
                })}
              </div>
            )}

            {/* The one match-time line: goals sit on it; other events float around it. */}
            <div
              className="pointer-events-none absolute left-0 top-[49%] h-px bg-gradient-to-r from-pitch/30 via-pitch/80 to-pitch/30"
              style={{ width: `${REGULATION_WIDTH}%` }}
            />

            {clockLeft != null && (
              <div
                className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-money shadow-glow transition-[left] duration-100"
                style={{ left: `${clockLeft}%` }}
              >
                <span className="num absolute left-1 top-5 rounded bg-money px-1 py-0.5 text-[9px] font-bold text-bg">
                  {Math.floor(clockMinute ?? 0)}&apos;
                </span>
              </div>
            )}

            {drag && hoverBucket != null && hoverBucket <= BEYOND_BUCKET && (
              <div
                className="pointer-events-none absolute inset-y-0 z-30 w-0 border-l-2 border-dashed border-money"
                style={{ left: `${((hoverBucket + 0.5) / MAIN_CELLS) * 100}%` }}
              >
                <span className="num absolute left-1 top-1 rounded bg-money px-1 py-0.5 text-[10px] font-bold text-bg">
                  {bucketLabel(hoverBucket)}
                </span>
              </div>
            )}

            {/* Proven/live event pins sit behind the user's predictions. */}
            {pools.map((pool) => {
              const actual = actuals?.[pool.id];
              if (actual == null || actual > BEYOND_BUCKET) return null;
              const row = rowOf(pool.marker);
              return (
                <div
                  key={`actual-${pool.id}`}
                  className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${((actual + 0.5) / MAIN_CELLS) * 100}%`, top: `${row.top}%` }}
                  title={`Actual ${shortTitle(pool.title)}: ${bucketLabel(actual)}`}
                >
                  <span className="absolute inset-0 animate-ping rounded-full bg-pitch/45" />
                  <span className="relative grid h-6 w-6 place-items-center rounded-full bg-pitch text-xs text-bg ring-2 ring-bg">
                    {pool.marker}
                  </span>
                </div>
              );
            })}

            {pools.map((pool) => {
              const bucket = placements[pool.id];
              if (bucket == null || bucket === NEVER_BUCKET) return null;
              const row = rowOf(pool.marker);
              const exact = actuals?.[pool.id] === bucket;
              return (
                <div
                  key={pool.id}
                  className={clsx(
                    "group absolute z-20 -translate-x-1/2 -translate-y-1/2",
                    drag?.poolId === pool.id && "opacity-35",
                  )}
                  style={{ left: `${((bucket + 0.5) / MAIN_CELLS) * 100}%`, top: `${row.top}%` }}
                >
                  <button
                    type="button"
                    onPointerDown={(event) => startDrag(pool.id, "marker", event)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedPoolId(pool.id);
                    }}
                    style={{ touchAction: editable ? "none" : "auto" }}
                    className={clsx(
                      "flex flex-col items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch",
                      editable && "cursor-grab active:cursor-grabbing",
                    )}
                    aria-label={`${shortTitle(pool.title)} prediction at ${bucketLabel(bucket)}${editable ? ", drag to move" : ""}`}
                  >
                    <span
                      className={clsx(
                        "grid h-8 w-8 place-items-center rounded-full ring-2 shadow-glow",
                        exact ? "bg-pitch/30 ring-pitch" : row.ring,
                      )}
                    >
                      <span className="text-lg leading-none" aria-hidden="true">{pool.marker}</span>
                    </span>
                    <span className={clsx("num mt-0.5 rounded bg-bg/80 px-1 text-[9px]", exact ? "text-pitch" : row.color)}>
                      {bucketLabel(bucket)}
                    </span>
                  </button>
                  {editable && (
                    <button
                      type="button"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        commitPlacement(pool.id, null);
                      }}
                      className="absolute -right-3 -top-3 grid h-6 w-6 place-items-center rounded-full border border-line bg-bg text-xs text-muted opacity-100 shadow-card transition hover:border-away hover:text-away focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-away sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                      aria-label={`Remove ${shortTitle(pool.title)} prediction`}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div
          ref={neverRef}
          className={clsx(
            "relative flex w-[5.5rem] shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl border text-center transition sm:w-24",
            drag && hoverBucket === NEVER_BUCKET
              ? "border-money bg-money/15 shadow-glow"
              : activePool && placements[activePool.id] === NEVER_BUCKET
                ? "border-money/50 bg-money/10"
                : "border-line bg-panel-2",
          )}
        >
          {editable && activePool && (
            <button
              type="button"
              onClick={() => commitPlacement(activePool.id, NEVER_BUCKET)}
              className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pitch"
              aria-label={`Predict ${shortTitle(activePool.title)} never happens`}
            />
          )}
          <span className="pointer-events-none relative z-10 text-[11px] font-bold tracking-wide text-muted">NEVER</span>
          {density && (
            <span className="pointer-events-none relative z-10 num mt-1 text-[10px] text-money">
              {density.neverCount}/{density.total} picks
            </span>
          )}
          <div className="relative z-10 mt-2 flex max-w-[4.5rem] flex-wrap justify-center gap-1">
            {pools
              .filter((pool) => placements[pool.id] === NEVER_BUCKET)
              .map((pool) => {
                const actual = actuals?.[pool.id] === NEVER_BUCKET;
                return (
                  <button
                    key={pool.id}
                    type="button"
                    onPointerDown={(event) => startDrag(pool.id, "marker", event)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedPoolId(pool.id);
                    }}
                    style={{ touchAction: editable ? "none" : "auto" }}
                    className={clsx(
                      "grid h-8 w-8 place-items-center rounded-full text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch",
                      actual ? "bg-pitch/25 ring-2 ring-pitch" : "bg-bg/50",
                      editable && "cursor-grab",
                    )}
                    aria-label={`${shortTitle(pool.title)} prediction: never${editable ? ", drag to move" : ""}`}
                  >
                    {pool.marker}
                  </button>
                );
              })}
          </div>
          {density && density.neverStake > 0 && (
            <span className="pointer-events-none relative z-10 num mt-1 text-[9px] text-muted">
              {density.neverStake.toFixed(0)} USDT
            </span>
          )}
        </div>
      </div>

      <p id="timeline-help" className="mt-2 text-[11px] leading-relaxed text-muted">
        {editable ? "Zoom in for an easier drop target. " : ""}
        Predictions always snap to a <span className="text-ink">5-minute settlement window</span> — zoom never changes what the proof settles. Every icon is an independent pool.
      </p>
      <span className="sr-only" aria-live="polite">{announcement}</span>

      {drag && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 text-3xl drop-shadow-lg"
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          {pools.find((pool) => pool.id === drag.poolId)?.marker}
        </div>
      )}
    </div>
  );
}

function shortTitle(title: string): string {
  return title.replace("Window of the ", "").replace(" card", "");
}
