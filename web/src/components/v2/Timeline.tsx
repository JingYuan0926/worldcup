"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, num } from "@/lib/v2/tokens";
import { EventIcon, type EventKind } from "@/components/v2/Icons";
import {
  AWAY,
  HOME,
  MATCH_EVENTS,
  MATCH_SECONDS,
  PHASE_MARKS,
  clockLabel,
  crowdBars,
  mmss,
  type Side,
} from "@/lib/v2/demo";

const LANE_H = 84;
const RULER_H = 40;
const CANVAS_H = LANE_H * 2 + RULER_H;

export interface Marker {
  id: string;
  kind: EventKind;
  side: Side;
  second: number;
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
}

function CrowdLane({ seed, color }: { seed: number; color: string }) {
  const bars = useMemo(() => crowdBars(seed), [seed]);
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", display: "flex", alignItems: "flex-end" }}>
      {bars.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${v * 66}%`,
            background: color,
            opacity: 0.18,
            marginRight: 1,
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
}: Props) {
  const [zoom, setZoom] = useState(1);
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
          border: `1px solid ${C.line}`,
          borderRadius: 10,
          overflow: "hidden",
          background: C.white,
        }}
      >
        <div className="v2-scroll" style={{ flex: 1, overflowX: "auto", overflowY: "hidden" }}>
          <div
            ref={rulerRef}
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
                    background: C.white,
                    cursor: onPlace ? "crosshair" : "default",
                    borderBottom: side === "home" ? `1px solid ${C.line}` : undefined,
                    borderTop: side === "away" ? `1px solid ${C.line}` : undefined,
                    overflow: "hidden",
                  }}
                >
                  <CrowdLane seed={side === "home" ? 1337 : 4242} color={t.color} />
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

            <div style={{ position: "absolute", left: 0, right: 0, top: LANE_H, height: RULER_H, background: C.white }}>
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
                      color: C.muted,
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
                    color: C.muted,
                    background: C.surface,
                    border: `1px solid ${C.line}`,
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
                  background: C.ink,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 2px 6px rgba(22,24,29,0.35)",
                  animation: "v2-land 0.5s cubic-bezier(.2,.9,.3,1.4) both",
                  zIndex: 5,
                }}
              >
                <EventIcon kind={e.kind} size={15} color={C.white} />
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
                    if (onPlace) dragRef.current = m.id;
                  }}
                  title={`${m.kind} · ${t.code} · ${mmss(m.second)}`}
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
                      border: `1.5px solid ${t.color}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: isSel ? `0 0 0 3px ${t.color}33` : "0 1px 3px rgba(22,24,29,0.2)",
                    }}
                  >
                    <EventIcon kind={m.kind} size={14} color={t.color} />
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
                  background: C.surface,
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
                  color: C.faint,
                  letterSpacing: "0.08em",
                  borderTop: `1px solid ${C.line2}`,
                  borderBottom: `1px solid ${C.line2}`,
                }}
              >
                0&apos;–120&apos;
              </div>
            ),
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9.5, color: C.muted, fontWeight: 700, letterSpacing: "0.12em" }}>ZOOM</span>
        <ZoomScrubber zoom={zoom} onZoom={setZoom} />
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
function ZoomScrubber({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
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
            <div style={{ position: "absolute", left: `${left}%`, top: 8, width: 1, height: 10, background: C.faint }} />
            <span
              style={{
                ...num,
                position: "absolute",
                left: `${left}%`,
                top: 19,
                transform: "translateX(-50%)",
                fontSize: 8.5,
                color: C.faint,
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
