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
import type { SecondCrowd } from "@/lib/crowdSim";

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
  /** Sparse per-second crowd (count + stake) for each lane. */
  crowd: { home: SecondCrowd; away: SecondCrowd };
  /**
   * Laid over the video rather than on the page. The canvas surfaces defer to
   * the strip's own background, the outer frame goes, and the labels darken —
   * the strip is scaled down to fit the video, so muted greys stop reading.
   */
  overlay?: boolean;
}

/**
 * The crowd, drawn per-second on a canvas. A sparse match holds thousands of
 * possible timestamps per lane; a canvas renders them all without spawning a DOM
 * node each, so zooming in resolves individual seconds and zooming out clusters
 * them into a dense texture. Height is normalised to the lane's own peak.
 */
function CrowdLane({ counts, color }: { counts: number[]; color: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      let max = 1;
      for (const c of counts) if (c > max) max = c;
      const n = counts.length;
      const step = rect.width / Math.max(1, n - 1);
      const barW = Math.max(0.7, Math.min(2.4, step));
      const usable = rect.height * 0.92;

      ctx.globalAlpha = 0.5;
      ctx.fillStyle = color;
      for (let s = 0; s < n; s++) {
        const c = counts[s]!;
        if (c <= 0) continue;
        const h = Math.max(2, (c / max) * usable);
        const x = Math.min(rect.width - barW, s * step);
        ctx.fillRect(x, rect.height - h, barW, h);
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [counts, color]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
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

  /**
   * Hover aggregates over a window that shrinks with zoom — a couple of minutes
   * zoomed out, down to ~15 seconds zoomed in — so the readout is never a lone,
   * usually-empty second while the bars stay at full per-second resolution.
   */
  const hoverWindow = Math.max(
    1,
    Math.round(MATCH_SECONDS / Math.min(560, Math.max(24, Math.round(60 * zoom)))),
  );

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
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 14 }}>
      {hover &&
        (() => {
          const winStart = Math.floor(hover.second / hoverWindow) * hoverWindow;
          const winEnd = Math.min(MATCH_SECONDS, winStart + hoverWindow - 1);
          const sum = (arr: number[]) => {
            let total = 0;
            for (let s = winStart; s <= winEnd; s++) total += arr[s] ?? 0;
            return total;
          };
          const rows = [
            { tm: HOME, stake: sum(crowd.home.stake), ppl: sum(crowd.home.count) },
            { tm: AWAY, stake: sum(crowd.away.stake), ppl: sum(crowd.away.count) },
          ];
          const totStake = rows.reduce((s, r) => s + r.stake, 0);
          const totPpl = rows.reduce((s, r) => s + r.ppl, 0);
          const usd = (base: number) => {
            const u = base / 1e6;
            return u >= 100 ? Math.round(u).toLocaleString() : u.toFixed(2);
          };
          return (
            <div
              style={{
                position: "absolute",
                top: 8,
                right: 102,
                zIndex: 9,
                pointerEvents: "none",
                background: C.white,
                border: `1px solid ${C.line}`,
                borderRadius: 10,
                padding: "10px 12px",
                minWidth: 196,
                boxShadow: "0 10px 30px rgba(2,6,23,0.16)",
                color: C.ink,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                <span style={{ ...num, fontSize: 15, fontWeight: 700 }}>{mmss(hover.second)}</span>
                <span style={{ ...num, fontSize: 10, color: C.muted }}>
                  {mmss(winStart)}–{mmss(winEnd)}
                </span>
              </div>
              {rows.map(({ tm, stake, ppl }) => (
                <div
                  key={tm.code}
                  style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tm.flag}
                    alt={tm.code}
                    width={18}
                    height={12}
                    style={{ borderRadius: 2, boxShadow: "0 0 0 1px rgba(22,24,29,0.12)", flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 700, color: tm.color, width: 34 }}>
                    {tm.code}
                  </span>
                  <span style={{ ...num, fontSize: 11, color: C.muted, flex: 1 }}>{ppl} bet</span>
                  <span style={{ ...num, fontSize: 12.5, fontWeight: 700 }}>{usd(stake)}</span>
                </div>
              ))}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderTop: `1px solid ${C.line2}`,
                  marginTop: 6,
                  paddingTop: 6,
                }}
              >
                <span style={{ fontSize: 11.5, fontWeight: 700, flex: 1 }}>Total</span>
                <span style={{ ...num, fontSize: 11, color: C.muted }}>{totPpl} bet</span>
                <span style={{ ...num, fontSize: 12.5, fontWeight: 800, marginLeft: 10 }}>
                  {usd(totStake)} USDC
                </span>
              </div>
            </div>
          );
        })()}
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
                  <CrowdLane
                    counts={side === "home" ? crowd.home.count : crowd.away.count}
                    color={t.color}
                  />
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

            {/* Guide line at the cursor; the readout itself is pinned top-right. */}
            {hover && (
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
            )}
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
