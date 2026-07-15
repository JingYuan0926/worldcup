"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { WalletButton } from "@/components/WalletButton";
import { bucketLabel, matchTime, placementToBucket } from "@/lib/format";
import {
  getSimulatedCrowdMinuteCounts,
  getSimulatedCrowdPeakSecond,
  getSimulatedCrowdSecondCounts,
  getSimulatedCrowdTotalCount,
} from "@/lib/simulatedCrowd";
import type { Fixture, Pool } from "@/lib/types";
import { SparseCrowdChart } from "./SparseCrowdChart";
import {
  CountryFlag,
  EventIcon,
  type TimelineEventKind,
} from "./TimelineIcons";

const MATCH_SECONDS = 120 * 60;
const REGULATION_SECONDS = 90 * 60;
const BUCKET_SECONDS = 5 * 60;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const EXACT_SECOND_GRAPH_ZOOM = 4;
const TIME_RULER_HEIGHT = 40;
const KIND_ORDER: TimelineEventKind[] = ["goal", "corner", "yellow", "red"];
const TERMINAL_PHASES = new Set([5, 10, 13]);

const LABEL: Record<TimelineEventKind, string> = {
  goal: "Goal",
  corner: "Corner",
  yellow: "Yellow card",
  red: "Red card",
};

interface TimelineMarker {
  id: number;
  kind: TimelineEventKind;
  team: "home" | "away";
  atSecond: number;
}

interface LiveTimelineEvent {
  id: string;
  seq: number;
  kind: TimelineEventKind;
  team: "home" | "away";
  matchClockSeconds: number;
  confirmed: boolean;
}

interface LiveTimelineSnapshot {
  fixtureId: number;
  generatedAt: string;
  recordedThroughTsMs: number;
  phase: number;
  phaseLabel?: string;
  score: { home: number; away: number };
  clock: {
    seconds: number;
    maxSeconds?: number | null;
    running: boolean;
    observedAtTsMs?: number | null;
    ageMs?: number;
  };
  events: LiveTimelineEvent[];
  coverage: {
    firstObservedSecond: number;
    firstObservedMatchClockSeconds: number | null;
    unknownOpeningSeconds: number;
    complete: boolean;
  };
}

type MarkerStatus = "pending" | "active" | "hit" | "missed" | "unknown";

export function ExactTimeTimeline({ fixture, pools }: { fixture: Fixture; pools: Pool[] }) {
  const availableKinds = useMemo(
    () => KIND_ORDER.filter((kind) => pools.some((pool) => pool.id.includes(kind))),
    [pools],
  );
  const [tool, setTool] = useState<TimelineEventKind>(availableKinds[0] ?? "goal");
  const [markers, setMarkers] = useState<TimelineMarker[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [live, setLive] = useState<LiveTimelineSnapshot | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const nextId = useRef(1);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const selected = markers.find((marker) => marker.id === selectedId) ?? null;
  const selectedBucket = selected
    ? placementToBucket({ kind: "time", atSecond: selected.atSecond })
    : null;
  const liveSecond = timelineProgressSecond(live);
  const matchDone = Boolean(live && TERMINAL_PHASES.has(live.phase));
  const firstPlaceableSecond = matchDone
    ? MATCH_SECONDS + 1
    : live
      ? Math.min(MATCH_SECONDS + 1, Math.floor(liveSecond) + 1)
      : 0;
  const markerStatuses = useMemo(
    () => resolveMarkerStatuses(markers, live, liveSecond),
    [live, liveSecond, markers],
  );
  const selectedStatus = selected ? markerStatuses.get(selected.id) ?? "pending" : null;
  const selectedLocked = Boolean(selected && selected.atSecond < firstPlaceableSecond);
  const livePickDelta = selected && live ? liveSecond - selected.atSecond : null;
  const simulatedCrowd = useMemo(() => {
    return {
      homeSeconds: getSimulatedCrowdSecondCounts(tool, "home"),
      awaySeconds: getSimulatedCrowdSecondCounts(tool, "away"),
      homeMinutes: getSimulatedCrowdMinuteCounts(tool, "home"),
      awayMinutes: getSimulatedCrowdMinuteCounts(tool, "away"),
      homeTotal: getSimulatedCrowdTotalCount(tool, "home"),
      awayTotal: getSimulatedCrowdTotalCount(tool, "away"),
      homePeak: getSimulatedCrowdPeakSecond(tool, "home"),
      awayPeak: getSimulatedCrowdPeakSecond(tool, "away"),
    };
  }, [tool]);
  const exactSecondGraph = zoom >= EXACT_SECOND_GRAPH_ZOOM;

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;

    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(`/api/live/${fixture.fixtureId}?network=devnet`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const next = (await response.json()) as LiveTimelineSnapshot;
        if (active) setLive(next);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          // The timeline remains fully usable while a recorder is unavailable.
        }
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [fixture.fixtureId]);

  const pointOnTrack = useCallback((clientX: number, clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return null;
    if (clientY < rect.top + TIME_RULER_HEIGHT) return null;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const graphCenter = rect.top + TIME_RULER_HEIGHT + (rect.height - TIME_RULER_HEIGHT) / 2;
    return {
      atSecond: Math.round(fraction * MATCH_SECONDS),
      team: (clientY < graphCenter ? "home" : "away") as "home" | "away",
    };
  }, []);

  const createMarker = (clientX: number, clientY: number) => {
    const point = pointOnTrack(clientX, clientY);
    if (!point) return;
    if (point.atSecond < firstPlaceableSecond) {
      setAnnouncement(`${matchTime(point.atSecond)} has already passed. Place the marker after the live line.`);
      return;
    }
    const marker: TimelineMarker = { id: nextId.current++, kind: tool, ...point };
    setMarkers((current) => [...current, marker]);
    setSelectedId(marker.id);
    setDragId(marker.id);
    setAnnouncement(`${LABEL[tool]} added for ${teamName(fixture, marker.team)} at ${matchTime(marker.atSecond)}`);
  };

  const updateDraggedMarker = useCallback(
    (id: number, clientX: number, clientY: number) => {
      const point = pointOnTrack(clientX, clientY);
      if (!point || point.atSecond < firstPlaceableSecond) return;
      setMarkers((current) => current.map((marker) => (marker.id === id ? { ...marker, ...point } : marker)));
    },
    [firstPlaceableSecond, pointOnTrack],
  );

  const autoScroll = useCallback((clientX: number) => {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    const rect = scroller.getBoundingClientRect();
    const edge = Math.min(72, rect.width * 0.2);
    if (clientX < rect.left + edge) scroller.scrollBy({ left: -24 });
    if (clientX > rect.right - edge) scroller.scrollBy({ left: 24 });
  }, []);

  useEffect(() => {
    if (dragId == null) return;
    const move = (event: PointerEvent) => {
      autoScroll(event.clientX);
      updateDraggedMarker(dragId, event.clientX, event.clientY);
    };
    const stop = () => setDragId(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };
  }, [autoScroll, dragId, updateDraggedMarker]);

  useEffect(() => {
    if (!selected) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const frame = requestAnimationFrame(() => {
      const x = (selected.atSecond / MATCH_SECONDS) * scroller.scrollWidth;
      scroller.scrollTo({ left: Math.max(0, x - scroller.clientWidth / 2), behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
    // Recenter only when zoom changes or a different marker is selected.
  }, [selectedId, zoom]);

  useEffect(() => {
    if (!live || selectedId != null || zoom === 1) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const x = (liveSecond / MATCH_SECONDS) * scroller.scrollWidth;
    scroller.scrollTo({ left: Math.max(0, x - scroller.clientWidth * 0.65), behavior: "smooth" });
  }, [live, liveSecond, selectedId, zoom]);

  const mutateSelected = useCallback(
    (change: (marker: TimelineMarker) => TimelineMarker) => {
      if (selectedId == null) return;
      setMarkers((current) => current.map((marker) => (marker.id === selectedId ? change(marker) : marker)));
    },
    [selectedId],
  );

  const adjustTime = (delta: number) =>
    mutateSelected((marker) => ({
      ...marker,
      atSecond: selectedLocked
        ? marker.atSecond
        : Math.max(firstPlaceableSecond, Math.min(MATCH_SECONDS, marker.atSecond + delta)),
    }));

  const removeMarker = (id: number) => {
    setMarkers((current) => current.filter((marker) => marker.id !== id));
    setSelectedId((current) => (current === id ? null : current));
    setDragId((current) => (current === id ? null : current));
    setAnnouncement("Marker removed");
  };

  const removeSelected = () => {
    if (selectedId != null) removeMarker(selectedId);
  };

  const tickStep = zoom >= 6 ? 60 : zoom >= 2.5 ? 5 * 60 : 15 * 60;
  const ticks = useMemo(
    () => Array.from({ length: Math.floor(MATCH_SECONDS / tickStep) + 1 }, (_, index) => index * tickStep),
    [tickStep],
  );

  return (
    <section className="flex min-h-dvh w-full flex-col justify-center bg-white px-4 py-8 text-slate-950 [color-scheme:light] sm:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-950"
          >
            <span aria-hidden>←</span>
            All matches
          </Link>
          <WalletButton />
        </div>
        <header className="mb-8 text-center">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            {fixture.competition} · {matchDone ? "Match done" : (live?.phaseLabel ?? "Live match")}
          </div>
          <h1 className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center text-3xl font-semibold tracking-tight text-slate-800 sm:text-5xl">
            <span className="flex min-w-0 items-center justify-end gap-2 sm:gap-4">
              <CountryFlag code={fixture.p1Code} className="h-8 w-12 shrink-0 overflow-hidden rounded-sm ring-1 ring-slate-200 sm:h-10 sm:w-[60px]" />
              <span className="truncate">{fixture.participant1}</span>
            </span>
            <span className="px-3 text-xl font-medium text-slate-300 sm:px-6 sm:text-2xl">vs</span>
            <span className="flex min-w-0 items-center justify-start gap-2 sm:gap-4">
              <span className="truncate">{fixture.participant2}</span>
              <CountryFlag code={fixture.p2Code} className="h-8 w-12 shrink-0 overflow-hidden rounded-sm ring-1 ring-slate-200 sm:h-10 sm:w-[60px]" />
            </span>
          </h1>
          <div className="mt-2 flex w-full justify-center">
            <span className="num text-2xl font-semibold tracking-tight text-blue-600 sm:text-3xl">
              {live ? `${live.score.home}:${live.score.away}` : "–:–"}
            </span>
          </div>
        </header>

        <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              {matchDone ? "Match done · select an event to view the crowd" : "Choose event, then place it on either team"}
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Event type">
              {availableKinds.map((kind) => {
                const active = tool === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => {
                      setTool(kind);
                      if (matchDone) setSelectedId(null);
                    }}
                    className={clsx(
                      "relative flex h-12 items-center gap-2 rounded-xl border-2 bg-white px-3 shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                      active
                        ? "border-blue-600 bg-white text-slate-950"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-950",
                    )}
                    aria-pressed={active}
                  >
                    <span className={clsx("grid h-7 w-7 place-items-center rounded-lg", active ? "text-slate-700" : "text-slate-500")}>
                      <EventIcon kind={kind} className="h-5 w-5" />
                    </span>
                    <span className="hidden text-xs font-medium sm:block">{LABEL[kind]}</span>
                    <span className={clsx("grid h-4 w-4 place-items-center rounded border text-[11px] font-bold", active ? "border-blue-600 bg-white text-blue-600" : "border-slate-300 bg-white")}>
                      {active ? "✓" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              {selected
                ? `${LABEL[selected.kind]} · ${teamName(fixture, selected.team)} · ${statusLabel(selectedStatus)}`
                : live
                  ? matchDone ? `${LABEL[tool]} crowd distribution` : "Live now"
                  : "No marker selected"}
            </div>
            {selected && live && (
              <div className="mt-1 flex items-center justify-end gap-3 text-[10px] font-semibold uppercase tracking-[0.14em]">
                <span className="text-slate-700">Your pick</span>
                <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">
                  {matchDone ? "Final clock" : "TxLINE now"} {matchTime(liveSecond)}
                </span>
              </div>
            )}
            <div className="mt-1 flex items-center justify-end gap-2">
              <button type="button" onClick={() => adjustTime(-1)} disabled={!selected || selectedLocked} className="grid h-10 w-10 place-items-center rounded-full text-xl text-slate-400 enabled:hover:bg-slate-100 enabled:hover:text-slate-950 disabled:opacity-25" aria-label="One second earlier">−</button>
              <output
                className={clsx(
                  "num min-w-[7ch] text-4xl font-semibold tracking-tight sm:text-5xl",
                  selected ? "text-blue-700" : matchDone ? "text-slate-700" : live ? "text-blue-700" : "text-slate-400",
                )}
              >
                {selected ? matchTime(selected.atSecond) : matchDone ? "FT" : live ? matchTime(liveSecond) : "--:--"}
              </output>
              <button type="button" onClick={() => adjustTime(1)} disabled={!selected || selectedLocked} className="grid h-10 w-10 place-items-center rounded-full text-xl text-slate-400 enabled:hover:bg-slate-100 enabled:hover:text-slate-950 disabled:opacity-25" aria-label="One second later">+</button>
            </div>
            <div className="num mt-1 flex flex-wrap items-center justify-end gap-3 text-[11px] text-slate-500">
              <span>
                {selectedBucket == null
                  ? matchDone
                    ? `final clock ${matchTime(liveSecond)}`
                    : "click a lane to add"
                  : `proof window ${bucketLabel(selectedBucket)} · ${statusDetail(selectedStatus)}`}
              </span>
              {livePickDelta != null && (
                <span className="font-semibold text-slate-600">{formatLiveDelta(livePickDelta)}</span>
              )}
              {selected && <button type="button" onClick={removeSelected} className="text-red-600 hover:underline">remove</button>}
            </div>
          </div>
        </div>

        {matchDone && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-[11px] text-slate-600">
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-slate-300 bg-white px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Simulated exact-second crowd
              </span>
              <span>
                {exactSecondGraph
                  ? `Every bar is one exact second · empty seconds have no ${LABEL[tool].toLowerCase()} picks`
                  : `One-minute overview of exact-second picks · zoom to ${EXACT_SECOND_GRAPH_ZOOM}× to reveal every second`}
              </span>
            </div>
            <div className="num flex flex-wrap items-center gap-x-5 gap-y-1 font-medium">
              <span className="text-[#1B4F9C]">
                {fixture.participant1} {simulatedCrowd.homeTotal} · peak {matchTime(simulatedCrowd.homePeak.second)} ({simulatedCrowd.homePeak.count})
              </span>
              <span className="text-[#A51F32]">
                {fixture.participant2} {simulatedCrowd.awayTotal} · peak {matchTime(simulatedCrowd.awayPeak.second)} ({simulatedCrowd.awayPeak.count})
              </span>
            </div>
          </div>
        )}

        <div className="relative">
          <div ref={scrollerRef} className="match-timeline-scroll overflow-x-auto overflow-y-hidden pb-4">
            <div
              ref={trackRef}
              role="group"
              tabIndex={0}
              aria-label={`Match event timeline. Upper lane ${fixture.participant1}, lower lane ${fixture.participant2}.`}
              onPointerDown={(event) => {
                event.preventDefault();
                createMarker(event.clientX, event.clientY);
              }}
              onKeyDown={(event) => {
                if (!selected) return;
                const step = event.shiftKey ? 60 : 1;
                if (event.key === "ArrowLeft") adjustTime(-step);
                else if (event.key === "ArrowRight") adjustTime(step);
                else if (event.key === "ArrowUp") mutateSelected((marker) => ({ ...marker, team: "home" }));
                else if (event.key === "ArrowDown") mutateSelected((marker) => ({ ...marker, team: "away" }));
                else if (event.key === "Delete" || event.key === "Backspace") removeSelected();
                else return;
                event.preventDefault();
              }}
              className="relative h-64 min-w-full cursor-crosshair overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:h-72"
              style={{ width: `${zoom * 100}%`, touchAction: "pan-y" }}
            >
              <div
                className="absolute inset-x-0 bg-[#1B4F9C]/[0.12]"
                style={{ top: TIME_RULER_HEIGHT, height: `calc((100% - ${TIME_RULER_HEIGHT}px) / 2)` }}
              />
              <div
                className="absolute inset-x-0 bottom-0 bg-[#C9293B]/[0.10]"
                style={{ height: `calc((100% - ${TIME_RULER_HEIGHT}px) / 2)` }}
              />
              {live && (
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 transition-[width] duration-700 ease-linear"
                  style={{
                    width: `${(liveSecond / MATCH_SECONDS) * 100}%`,
                    backgroundColor: "#F3F4F6",
                    backgroundImage:
                      "repeating-linear-gradient(135deg, transparent 0, transparent 8px, rgba(100,116,139,0.24) 8px, rgba(100,116,139,0.24) 10px)",
                  }}
                >
                  <span className="absolute bottom-2 left-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Passed · locked
                  </span>
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-10 rounded-t-2xl border-b border-slate-200 bg-white shadow-[0_1px_0_rgba(148,163,184,0.14)]" />
              {matchDone && (
                <SparseCrowdChart
                  homeCounts={exactSecondGraph ? simulatedCrowd.homeSeconds : simulatedCrowd.homeMinutes}
                  awayCounts={exactSecondGraph ? simulatedCrowd.awaySeconds : simulatedCrowd.awayMinutes}
                  homeName={fixture.participant1}
                  awayName={fixture.participant2}
                  resolution={exactSecondGraph ? "second" : "minute"}
                  topInset={TIME_RULER_HEIGHT}
                />
              )}

              {ticks.map((second) => {
                const minute = second / 60;
                const major = minute % 15 === 0;
                return (
                  <div key={second} className="pointer-events-none absolute inset-y-0 z-[32] -translate-x-1/2" style={{ left: `${(second / MATCH_SECONDS) * 100}%` }}>
                    <div className={clsx("mx-auto mt-10 h-[calc(100%-2.5rem)] w-px", major ? "bg-slate-200" : "bg-slate-100")} />
                    {(major || zoom >= 6) && (
                      <span className={clsx("num absolute top-0 grid h-10 place-items-center px-1 text-[10px] font-semibold leading-none text-slate-500", second === 0 ? "left-1" : second === MATCH_SECONDS ? "right-1" : "left-1/2 -translate-x-1/2")}>{minute}&apos;</span>
                    )}
                  </div>
                );
              })}

              <div className="pointer-events-none absolute bottom-0 top-10 w-px bg-slate-300" style={{ left: `${(REGULATION_SECONDS / MATCH_SECONDS) * 100}%` }} />

              {live && (
                <div
                  className="pointer-events-none absolute inset-y-0 z-40 w-px -translate-x-1/2 bg-blue-600 shadow-[0_0_14px_rgba(37,99,235,0.25)] transition-[left] duration-700 ease-linear"
                  style={{ left: `${(liveSecond / MATCH_SECONDS) * 100}%` }}
                >
                  <span className="num absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-blue-600 px-2 py-1 text-[10px] font-bold text-white shadow-sm">
                    {matchTime(liveSecond)} · {matchDone ? "MATCH DONE" : "TXLINE NOW"}
                  </span>
                </div>
              )}

              {selected && (
                <div className="pointer-events-none absolute bottom-0 top-10 z-10 w-0 -translate-x-1/2 border-l-2 border-dashed border-slate-400" style={{ left: `${(selected.atSecond / MATCH_SECONDS) * 100}%` }} />
              )}

              {markers.map((marker) => {
                const active = marker.id === selectedId;
                const status = markerStatuses.get(marker.id) ?? "pending";
                return (
                  <div
                    key={marker.id}
                    className="absolute z-20 h-11 w-11 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${(marker.atSecond / MATCH_SECONDS) * 100}%`, top: marker.team === "home" ? "27%" : "73%" }}
                  >
                    <button
                      type="button"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setSelectedId(marker.id);
                        if (marker.atSecond >= firstPlaceableSecond) setDragId(marker.id);
                      }}
                      onClick={(event) => event.stopPropagation()}
                      className={clsx(
                        "grid h-full w-full place-items-center rounded-full border-4 border-white shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                        active ? "bg-blue-600 text-white shadow-md" : "bg-white text-slate-900 ring-1 ring-slate-200",
                        status === "active" && "ring-2 ring-blue-400 ring-offset-2 ring-offset-white",
                        status === "hit" && "ring-2 ring-blue-600 ring-offset-2 ring-offset-white",
                        status === "missed" && "bg-red-50 text-red-600 ring-2 ring-red-500 ring-offset-2 ring-offset-white",
                        status === "unknown" && "outline outline-1 outline-dashed outline-slate-400 outline-offset-2",
                      )}
                      style={{ touchAction: "none" }}
                      aria-label={`${LABEL[marker.kind]} for ${teamName(fixture, marker.team)} at ${matchTime(marker.atSecond)}, ${statusLabel(status)}`}
                    >
                      <EventIcon kind={marker.kind} className="h-6 w-6" />
                      {active && (
                        <span
                          className={clsx(
                            "num pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold",
                            status === "missed"
                              ? "bg-red-600 text-white"
                              : status === "hit"
                                ? "bg-blue-700 text-white"
                                : status === "active"
                                  ? "bg-blue-600 text-white"
                                  : "bg-blue-600 text-white",
                          )}
                        >
                          YOUR PICK {matchTime(marker.atSecond)} · {statusLabel(status)}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeMarker(marker.id);
                      }}
                      className="absolute -right-2.5 -top-2.5 z-30 grid h-6 w-6 place-items-center rounded-full border border-slate-200 bg-white text-sm leading-none text-slate-500 shadow-md transition hover:border-red-600 hover:bg-red-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                      aria-label={`Delete ${LABEL[marker.kind]} at ${matchTime(marker.atSecond)}`}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pointer-events-none absolute right-3 top-[19%] z-30 flex items-center gap-2 rounded-lg border border-[#1B4F9C]/40 bg-white px-2 py-1 shadow-sm">
            <CountryFlag code={fixture.p1Code} className="h-6 w-9 overflow-hidden rounded-sm" />
            <span className="hidden text-xs font-semibold text-[#1B4F9C] sm:block">{fixture.participant1}</span>
          </div>
          <div className="pointer-events-none absolute bottom-[27%] right-3 z-30 flex items-center gap-2 rounded-lg border border-[#C9293B]/40 bg-white px-2 py-1 shadow-sm">
            <CountryFlag code={fixture.p2Code} className="h-6 w-9 overflow-hidden rounded-sm" />
            <span className="hidden text-xs font-semibold text-[#A51F32] sm:block">{fixture.participant2}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-xl text-xs leading-relaxed text-slate-500">
            {matchDone
              ? "Match done. Placement is locked, but all four event buttons remain graph filters. The source data stores every exact second; empty timestamps mean nobody picked that second. The 1× view totals by minute for readability, then 4×–8× reveals the sparse second-by-second bars. Demo counts are simulated, not real entries."
              : "The vertical blue line is TxLINE now; the dashed grey line is your pick. Passed time is grey and locked. The lane tints follow each country."}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value - 0.5))} className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-lg text-slate-700 shadow-sm hover:bg-slate-50" aria-label="Zoom out">−</button>
            <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.5} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="w-24 accent-blue-600 sm:w-36" aria-label="Timeline zoom" />
            <button type="button" onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value + 0.5))} className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-lg text-slate-700 shadow-sm hover:bg-slate-50" aria-label="Zoom in">+</button>
            <span className="num w-8 text-xs text-slate-500">{zoom}×</span>
          </div>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </section>
  );
}

function teamName(fixture: Fixture, team: "home" | "away"): string {
  return team === "home" ? fixture.participant1 : fixture.participant2;
}

function formatLiveDelta(deltaSeconds: number): string {
  const rounded = Math.round(Math.abs(deltaSeconds));
  if (rounded === 0) return "pick matches live now";
  return deltaSeconds > 0
    ? `pick ${matchTime(rounded)} behind live`
    : `pick ${matchTime(rounded)} ahead of live`;
}

function timelineProgressSecond(live: LiveTimelineSnapshot | null): number {
  if (!live) return 0;
  let second = live.clock.seconds;
  if (TERMINAL_PHASES.has(live.phase)) {
    const minimumFinalClock = live.phase === 5 ? REGULATION_SECONDS : MATCH_SECONDS;
    second = Math.max(second, live.clock.maxSeconds ?? 0, minimumFinalClock);
  }
  if (live.clock.running && live.clock.observedAtTsMs) {
    // The feed is action-driven, so interpolate between authoritative clock
    // observations. The one-second API refresh rerenders this projection.
    const sinceObservation = Math.max(0, (Date.now() - live.clock.observedAtTsMs) / 1_000);
    second += Math.min(15, sinceObservation);
  }
  // First-half stoppage uses 45+ notation. Capping the fill prevents the
  // visual playhead from moving backwards when H2 resets to 45:00.
  if (live.phase === 2 || live.phase === 3) second = Math.min(second, 45 * 60);
  if (live.phase === 1) second = 0;
  return Math.max(0, Math.min(MATCH_SECONDS, second));
}

function markerGroup(kind: TimelineEventKind, team: "home" | "away"): string {
  return `${kind}:${team}`;
}

/**
 * Match actual events to predictions one-to-one inside their provable 5-minute
 * windows. One real goal cannot make several user markers look successful.
 */
function resolveMarkerStatuses(
  markers: TimelineMarker[],
  live: LiveTimelineSnapshot | null,
  liveSecond: number,
): Map<number, MarkerStatus> {
  const result = new Map(markers.map((marker) => [marker.id, "pending" as MarkerStatus]));
  if (!live) return result;

  const matched = new Set<number>();
  const groups = new Map<string, TimelineMarker[]>();
  for (const marker of markers) {
    const key = markerGroup(marker.kind, marker.team);
    groups.set(key, [...(groups.get(key) ?? []), marker]);
  }

  const events = live.events
    .filter((event) => event.confirmed)
    .sort((a, b) => a.matchClockSeconds - b.matchClockSeconds || a.seq - b.seq);
  for (const event of events) {
    const eventBucket = placementToBucket({ kind: "time", atSecond: event.matchClockSeconds });
    const candidates = (groups.get(markerGroup(event.kind, event.team)) ?? [])
      .filter((marker) => !matched.has(marker.id))
      .filter((marker) => placementToBucket({ kind: "time", atSecond: marker.atSecond }) === eventBucket)
      .sort(
        (a, b) =>
          Math.abs(a.atSecond - event.matchClockSeconds) - Math.abs(b.atSecond - event.matchClockSeconds) ||
          a.atSecond - b.atSecond ||
          a.id - b.id,
      );
    const winner = candidates[0];
    if (winner) {
      matched.add(winner.id);
      result.set(winner.id, "hit");
    }
  }

  const firstObservedClock = live.coverage.firstObservedMatchClockSeconds;
  const terminal = TERMINAL_PHASES.has(live.phase);
  for (const marker of markers) {
    if (matched.has(marker.id)) continue;
    const bucket = placementToBucket({ kind: "time", atSecond: marker.atSecond });
    const bucketStart = bucket >= 18 ? REGULATION_SECONDS : bucket * BUCKET_SECONDS;
    const bucketEnd = bucket >= 18 ? MATCH_SECONDS : (bucket + 1) * BUCKET_SECONDS;
    const openingWasObserved = firstObservedClock != null && bucketStart >= firstObservedClock;

    if (!openingWasObserved && live.coverage.unknownOpeningSeconds > 0) {
      result.set(marker.id, "unknown");
    } else if (terminal || liveSecond >= bucketEnd) {
      result.set(marker.id, "missed");
    } else if (liveSecond >= bucketStart) {
      result.set(marker.id, "active");
    }
  }

  return result;
}

function statusLabel(status: MarkerStatus | null): string {
  if (status === "hit") return "hit";
  if (status === "missed") return "window missed";
  if (status === "active") return "window live";
  if (status === "unknown") return "awaiting history";
  return "pending";
}

function statusDetail(status: MarkerStatus | null): string {
  if (status === "hit") return "event seen on TxLINE";
  if (status === "missed") return "window closed without event";
  if (status === "active") return "proof window still open";
  if (status === "unknown") return "opening backfill needed";
  return "waiting for live time";
}
