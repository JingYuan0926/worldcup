"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, num } from "@/lib/tokens";
import { EventIcon, type EventKind } from "@/components/Icons";
import {
  AWAY,
  HOME,
  MATCH_EVENTS,
  MATCH_SECONDS,
  PHASE_MARKS,
  clockLabel,
  mmss,
  type Side,
} from "@/lib/demo";
import { bucketLabel, bucketOf, bucketRange } from "@/lib/pools";

const LANE_H = 84;
const RULER_H = 40;
const CANVAS_H = LANE_H * 2 + RULER_H;

export interface Marker {
  id: string;
  kind: EventKind;
  side: Side;
  second: number;
  /**
   * Set only on markers hydrated from an on-chain entry. The chain stores a
   * 5-minute bucket, not a second, so a hydrated marker's pool is authoritative
   * and must NOT be re-derived from its position on the lane — the bucket
   * midpoint it renders at could otherwise sort into a different ordinal.
   */
  poolIndex?: number;
  /** True once staked: the entry is immutable on-chain, so the marker is too. */
  staked?: boolean;
}

interface Props {
  markers: Marker[];
  selectedId: string | null;
  tool: EventKind;
  /** null in live/settled mode — the canvas stops accepting placements at lock. */
  onPlace: ((side: Side, second: number) => void) | null;
  onMove: (id: string, second: number, side: Side) => void;
  onSelect: (id: string | null) => void;
  /** Live clock position in seconds, or null pre-match. */
  now: number | null;
  /** Real events revealed so far. */
  revealed: number;
  /** Staked lamports per 5-minute bucket, per lane — read from the pools on-chain. */
  crowd: { home: number[]; away: number[] };
  /**
   * Laid over the video rather than on the page. The canvas surfaces defer to
   * the strip's own background, the outer frame goes, and the labels darken —
   * the strip is scaled down to fit the video, so muted greys stop reading.
   */
  overlay?: boolean;
}

/** Slots across the lane. Fine enough to read as texture rather than blocks. */
const CROWD_SLOTS = 220;

/**
 * Turn per-bucket stake totals into a density curve sampled across the match clock.
 *
 * Two things this fixes over drawing one bar per bucket:
 *
 * 1. **Alignment.** Buckets are not equal width in time — 0–17 cover five minutes
 *    each, but 18 absorbs everything from 90' to full time, which on this fixture
 *    is 34 minutes. Nineteen equal-width bars therefore drift out of sync with the
 *    ruler above them. Sampling in TIME space puts every bar under the minute it
 *    describes.
 *
 * 2. **Honesty about size.** Plotting a wide bucket's total at the same width as a
 *    narrow one overstates it. What is plotted is stake per second, so the 34-minute
 *    bucket reads as the thin spread it is rather than a tower.
 *
 * The curve is interpolated and smoothed between bucket centres — a density plot of
 * real totals, not invented detail. Nothing is jittered: every wiggle is money.
 */
function densityCurve(crowd: number[]): number[] {
  const centres = crowd.map((stake, b) => {
    const { start, end } = bucketRange(b);
    const seconds = Math.max(1, end - start + 1);
    return { t: (start + end) / 2, v: stake / seconds };
  });
  if (centres.length === 0) return [];

  // Linear interpolation in time space…
  const raw: number[] = [];
  for (let i = 0; i < CROWD_SLOTS; i++) {
    const t = ((i + 0.5) / CROWD_SLOTS) * MATCH_SECONDS;
    let j = 0;
    while (j < centres.length - 1 && centres[j + 1]!.t < t) j++;
    const a = centres[j]!;
    const b = centres[Math.min(j + 1, centres.length - 1)]!;
    if (b.t === a.t || t <= a.t) raw.push(a.v);
    else if (t >= b.t) raw.push(b.v);
    else raw.push(a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t));
  }

  // …then a light box blur, so the joins read as a curve instead of facets.
  let cur = raw;
  for (let pass = 0; pass < 3; pass++) {
    cur = cur.map((_, i) => {
      const l = cur[Math.max(0, i - 1)]!;
      const c = cur[i]!;
      const r = cur[Math.min(cur.length - 1, i + 1)]!;
      return (l + 2 * c + r) / 4;
    });
  }
  return cur;
}

/**
 * Where the money actually sits: staked USDC per moment of the match, across this
 * lane's goal pools.
 *
 * This used to be `crowdBars(seed)` — seeded noise shaped to look plausible. It is
 * now read from the pools' on-chain entries, which means an empty lane renders
 * empty. That is the honest state before anyone bets, and it is also the point:
 * the shape tells you whether your call is crowded or lonely, and a fake histogram
 * tells you nothing while implying everything.
 */
function CrowdLane({ crowd, color }: { crowd: number[]; color: string }) {
  const bars = useMemo(() => densityCurve(crowd), [crowd]);
  const max = useMemo(() => Math.max(...bars, Number.EPSILON), [bars]);
  const empty = max <= Number.EPSILON;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        display: "flex",
        alignItems: "flex-end",
        gap: 1,
        paddingRight: 1,
      }}
    >
      {bars.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            // Floor the height so a funded slot never renders as nothing.
            height: empty ? 0 : `${Math.max(1.5, (v / max) * 68)}%`,
            background: color,
            opacity: empty ? 0 : 0.28,
            borderRadius: "1px 1px 0 0",
          }}
        />
      ))}
    </div>
  );
}

export function Timeline({
  markers,
  selectedId,
  tool,
  onPlace,
  onMove,
  onSelect,
  now,
  revealed,
  crowd,
  overlay = false,
}: Props) {
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<{ px: number; second: number } | null>(null);
  const canvasBg = overlay ? "transparent" : C.white;
  const labelColor = overlay ? C.ink : C.muted;
  const faintColor = overlay ? C.ink2 : C.faint;
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<string | null>(null);

  const pctOf = (second: number) => (second / MATCH_SECONDS) * 100;

  const secondAt = useCallback((clientX: number): number => {
    const el = rulerRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const ratio = (clientX - r.left) / r.width;
    return Math.round(Math.min(1, Math.max(0, ratio)) * MATCH_SECONDS);
  }, []);

  const sideAt = useCallback((clientY: number): Side => {
    const el = rulerRef.current;
    if (!el) return "home";
    const r = el.getBoundingClientRect();
    return clientY - r.top < r.height / 2 ? "home" : "away";
  }, []);

  useEffect(() => {
    if (!dragRef.current) return;
    const move = (e: PointerEvent) => {
      const id = dragRef.current;
      if (!id) return;
      onMove(id, secondAt(e.clientX), sideAt(e.clientY));
    };
    const up = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  });

  const ticks = useMemo(() => {
    const out: { second: number; major: boolean }[] = [];
    for (let m = 0; m <= 120; m += 5) out.push({ second: m * 60, major: m % 15 === 0 });
    return out;
  }, []);

  /**
   * Anything anchored at 0' or 120' would lose half its box off the edge of the
   * canvas under a plain -50% centring, which clipped "KICK OFF" to "OFF". Pin
   * the first and last to their inside edge instead.
   */
  const edgeShift = (second: number): string => {
    if (second <= 0) return "translateX(0)";
    if (second >= MATCH_SECONDS) return "translateX(-100%)";
    return "translateX(-50%)";
  };

  const selected = markers.find((m) => m.id === selectedId) ?? null;
  const pins = MATCH_EVENTS.slice(0, revealed);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "flex",
          border: overlay ? "none" : `1px solid ${C.line}`,
          borderRadius: 10,
          overflow: "hidden",
          background: canvasBg,
        }}
      >
        <div className="v2-scroll-hide" style={{ flex: 1, overflowX: "auto", overflowY: "hidden" }}>
          <div
            ref={rulerRef}
            onPointerMove={(e) => {
              const el = rulerRef.current;
              if (!el) return;
              const r = el.getBoundingClientRect();
              setHover({ px: e.clientX - r.left, second: secondAt(e.clientX) });
            }}
            onPointerLeave={() => setHover(null)}
            style={{ position: "relative", height: CANVAS_H, width: `${zoom * 100}%`, minWidth: "100%" }}
          >
            {(["home", "away"] as Side[]).map((side) => {
              const top = side === "home" ? 0 : LANE_H + RULER_H;
              const t = side === "home" ? HOME : AWAY;
              return (
                <div
                  key={side}
                  onPointerDown={(e) => {
                    if (!onPlace) return;
                    if ((e.target as HTMLElement).dataset.marker) return;
                    onPlace(side, secondAt(e.clientX));
                  }}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top,
                    height: LANE_H,
                    background: canvasBg,
                    cursor: onPlace ? "crosshair" : "default",
                    borderBottom: side === "home" ? `1px solid ${C.line}` : undefined,
                    borderTop: side === "away" ? `1px solid ${C.line}` : undefined,
                    overflow: "hidden",
                  }}
                >
                  <CrowdLane crowd={side === "home" ? crowd.home : crowd.away} color={t.color} />
                </div>
              );
            })}

            {now !== null &&
              (["home", "away"] as Side[]).map((side) => (
                <div
                  key={`hatch-${side}`}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: side === "home" ? 0 : LANE_H + RULER_H,
                    height: LANE_H,
                    width: `${pctOf(now)}%`,
                    background:
                      "repeating-linear-gradient(45deg, rgba(138,145,156,0.16) 0 4px, transparent 4px 9px)",
                    pointerEvents: "none",
                  }}
                />
              ))}

            <div style={{ position: "absolute", left: 0, right: 0, top: LANE_H, height: RULER_H, background: canvasBg }}>
              {ticks.map((tk) => (
                <div
                  key={tk.second}
                  style={{
                    position: "absolute",
                    left: `${pctOf(tk.second)}%`,
                    top: 0,
                    width: 1,
                    height: tk.major ? 10 : 6,
                    background: C.hair,
                  }}
                />
              ))}
              {ticks
                .filter((tk) => tk.major)
                .map((tk) => (
                  <span
                    key={`l-${tk.second}`}
                    style={{
                      ...num,
                      position: "absolute",
                      left: `${pctOf(tk.second)}%`,
                      top: 15,
                      transform: edgeShift(tk.second),
                      fontSize: 10,
                      color: labelColor,
                    }}
                  >
                    {clockLabel(tk.second)}
                  </span>
                ))}
              {PHASE_MARKS.map((p) => (
                <span
                  key={p.label}
                  style={{
                    position: "absolute",
                    left: `${pctOf(p.second)}%`,
                    top: "50%",
                    transform: `${edgeShift(p.second)} translateY(-50%)`,
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: "0.09em",
                    color: overlay ? C.ink : C.muted,
                    background: C.surface,
                    border: `1px solid ${overlay ? C.hair : C.line}`,
                    borderRadius: 99,
                    padding: "2px 8px",
                    whiteSpace: "nowrap",
                    zIndex: 2,
                  }}
                >
                  {p.label}
                </span>
              ))}
            </div>

            {selected && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${pctOf(selected.second)}%`,
                  width: 2,
                  background: selected.side === "home" ? HOME.color : AWAY.color,
                  boxShadow: `0 0 8px ${selected.side === "home" ? HOME.color : AWAY.color}`,
                  pointerEvents: "none",
                  zIndex: 4,
                }}
              />
            )}

            {pins.map((e, i) => (
              <div
                key={`pin-${i}`}
                title={`${e.player} · ${mmss(e.second)}`}
                style={{
                  position: "absolute",
                  left: `${pctOf(e.second)}%`,
                  top: (e.side === "home" ? LANE_H / 2 : LANE_H + RULER_H + LANE_H / 2) - 13,
                  transform: "translateX(-50%)",
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  // The artwork carries its own colour, so the disc has to stay
                  // neutral — a filled ink disc used to hide it entirely.
                  background: C.white,
                  border: `1.5px solid ${C.ink}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 2px 6px rgba(22,24,29,0.35)",
                  animation: "v2-land 0.5s cubic-bezier(.2,.9,.3,1.4) both",
                  zIndex: 5,
                }}
              >
                <EventIcon kind={e.kind} size={15} />
              </div>
            ))}

            {markers.map((m) => {
              const t = m.side === "home" ? HOME : AWAY;
              const isSel = m.id === selectedId;
              const resolved = now !== null && m.second <= now;
              return (
                <div
                  key={m.id}
                  data-marker="1"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelect(m.id);
                    // A staked marker mirrors an on-chain entry, which is immutable —
                    // dragging it would only ever lie about where the money is.
                    if (onPlace && !m.staked) dragRef.current = m.id;
                  }}
                  title={
                    m.staked
                      ? `${t.code} goal · staked on ${mmss(m.second)}'s window · on-chain, cannot move`
                      : `${m.kind} · ${t.code} · ${mmss(m.second)}`
                  }
                  style={{
                    position: "absolute",
                    left: `${pctOf(m.second)}%`,
                    top: (m.side === "home" ? LANE_H / 2 : LANE_H + RULER_H + LANE_H / 2) - 13,
                    transform: "translateX(-50%)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                    cursor: onPlace ? "grab" : "default",
                    zIndex: 6,
                    opacity: resolved ? 0.42 : 1,
                  }}
                >
                  <div
                    data-marker="1"
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      background: C.white,
                      // Staked reads as a heavy ring, not a fill: the icon is
                      // artwork and a filled disc would bury it.
                      border: `${m.staked ? 3 : 1.5}px solid ${t.color}`,
                      cursor: m.staked ? "default" : undefined,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: isSel ? `0 0 0 3px ${t.color}33` : "0 1px 3px rgba(22,24,29,0.2)",
                    }}
                  >
                    <EventIcon kind={m.kind} size={m.staked ? 12 : 14} />
                  </div>
                  <span
                    style={{
                      ...num,
                      fontSize: 9.5,
                      fontWeight: 600,
                      color: t.color,
                      background: "rgba(255,255,255,0.92)",
                      borderRadius: 3,
                      padding: "0 3px",
                    }}
                  >
                    {mmss(m.second)}
                  </span>
                </div>
              );
            })}

            {now !== null && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${pctOf(now)}%`,
                  width: 2,
                  background: C.ink,
                  pointerEvents: "none",
                  zIndex: 7,
                }}
              >
                <span
                  style={{
                    ...num,
                    position: "absolute",
                    top: 3,
                    left: 0,
                    transform: edgeShift(now),
                    fontSize: 10,
                    fontWeight: 700,
                    color: C.white,
                    background: C.ink,
                    borderRadius: 4,
                    padding: "2px 6px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {mmss(now)}
                </span>
              </div>
            )}

            {/*
              Hover readout: how much the crowd staked in the window under the
              cursor, split by lane (top = home, bottom = away) plus the total.
            */}
            {hover &&
              (() => {
                const b = bucketOf(hover.second);
                const h = crowd.home[b] ?? 0;
                const a = crowd.away[b] ?? 0;
                const total = h + a;
                const fmt = (base: number) => {
                  const u = base / 1e6;
                  return u >= 100 ? Math.round(u).toLocaleString() : u.toFixed(2);
                };
                return (
                  <>
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: hover.px,
                        width: 1,
                        background: overlay ? C.ink2 : C.faint,
                        pointerEvents: "none",
                        zIndex: 6,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: hover.px,
                        top: 6,
                        transform:
                          hover.px > 190 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
                        zIndex: 9,
                        pointerEvents: "none",
                        background: C.ink,
                        color: C.white,
                        borderRadius: 8,
                        padding: "9px 11px",
                        minWidth: 138,
                        boxShadow: "0 10px 26px rgba(2,6,23,0.4)",
                      }}
                    >
                      <div
                        style={{
                          ...num,
                          fontSize: 10.5,
                          fontWeight: 700,
                          opacity: 0.7,
                          letterSpacing: "0.04em",
                          marginBottom: 6,
                        }}
                      >
                        {bucketLabel(b)}
                      </div>
                      {(
                        [
                          [HOME, h],
                          [AWAY, a],
                        ] as const
                      ).map(([tm, v]) => (
                        <div
                          key={tm.code}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 14,
                            fontSize: 11.5,
                            marginBottom: 3,
                          }}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span
                              style={{ width: 7, height: 7, borderRadius: "50%", background: tm.color }}
                            />
                            {tm.code}
                          </span>
                          <span style={{ ...num, fontWeight: 700 }}>{fmt(v)}</span>
                        </div>
                      ))}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 14,
                          fontSize: 11.5,
                          borderTop: "1px solid rgba(255,255,255,0.16)",
                          marginTop: 5,
                          paddingTop: 5,
                        }}
                      >
                        <span style={{ opacity: 0.75 }}>Total</span>
                        <span style={{ ...num, fontWeight: 800 }}>{fmt(total)} USDC</span>
                      </div>
                    </div>
                  </>
                );
              })()}
          </div>
        </div>

        <div
          style={{
            flexShrink: 0,
            width: 94,
            borderLeft: `1px solid ${C.line}`,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {[HOME, null, AWAY].map((t, i) =>
            t ? (
              <div
                key={t.code}
                style={{
                  height: LANE_H,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  background: overlay ? "transparent" : C.surface,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={t.flag}
                  alt={t.name}
                  width={26}
                  height={17}
                  style={{ borderRadius: 2, boxShadow: "0 0 0 1px rgba(22,24,29,0.15)" }}
                />
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", color: t.color }}>
                  {t.code}
                </span>
              </div>
            ) : (
              <div
                key={`sep-${i}`}
                style={{
                  height: RULER_H,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  color: faintColor,
                  letterSpacing: "0.08em",
                  borderTop: `1px solid ${C.line2}`,
                  borderBottom: `1px solid ${C.line2}`,
                }}
              >
                0&apos;–{clockLabel(MATCH_SECONDS)}
              </div>
            ),
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9.5, color: labelColor, fontWeight: 700, letterSpacing: "0.12em" }}>ZOOM</span>
        <ZoomScrubber zoom={zoom} onZoom={setZoom} tickColor={faintColor} />
        <span style={{ ...num, fontSize: 11, color: C.ink2, minWidth: 38 }}>{zoom.toFixed(1)}×</span>
      </div>
    </div>
  );
}

/**
 * A precision control rather than a settings toggle: thin track, small barbell
 * thumb, ticks at the named stops. Zoom widens the ruler and never changes a
 * marker's stored second.
 */
function ZoomScrubber({
  zoom,
  onZoom,
  tickColor,
}: {
  zoom: number;
  onZoom: (z: number) => void;
  tickColor: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const down = useRef(false);

  const toZoom = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    // Geometric 1×–8× so each octave gets equal travel.
    onZoom(Number((1 * Math.pow(8, ratio)).toFixed(2)));
  }, [onZoom]);

  useEffect(() => {
    const move = (e: PointerEvent) => down.current && toZoom(e.clientX);
    const up = () => {
      down.current = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [toZoom]);

  const pct = (Math.log(zoom) / Math.log(8)) * 100;
  const stops = [1, 2, 4, 8];

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        down.current = true;
        toZoom(e.clientX);
      }}
      style={{ position: "relative", width: 210, height: 26, cursor: "ew-resize", touchAction: "none" }}
    >
      <div style={{ position: "absolute", left: 0, right: 0, top: 12, height: 2, background: C.hair }} />
      {stops.map((s) => {
        const left = (Math.log(s) / Math.log(8)) * 100;
        return (
          <div key={s}>
            <div style={{ position: "absolute", left: `${left}%`, top: 8, width: 1, height: 10, background: tickColor }} />
            <span
              style={{
                ...num,
                position: "absolute",
                left: `${left}%`,
                top: 19,
                transform: "translateX(-50%)",
                fontSize: 8.5,
                color: tickColor,
              }}
            >
              {s}×
            </span>
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: `${pct}%`,
          top: 6,
          transform: "translateX(-50%)",
          width: 8,
          height: 14,
          background: C.ink,
          borderRadius: 2,
        }}
      />
    </div>
  );
}
