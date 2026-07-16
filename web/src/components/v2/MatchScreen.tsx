"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { C, num } from "@/lib/v2/tokens";
import { BallIcon, CornerIcon, EventIcon, RedCardIcon, YellowCardIcon, type EventKind } from "@/components/v2/Icons";
import { Segmented } from "@/components/v2/Segmented";
import { Timeline, type Marker } from "@/components/v2/Timeline";
import { FlashRail, type FlashCall } from "@/components/v2/FlashRail";
import { SettlementPanel } from "@/components/v2/SettlementPanel";
import {
  AWAY,
  FIXTURE,
  HOME,
  MATCH_EVENTS,
  MATCH_SECONDS,
  mmss,
  team,
  windowFor,
  type Side,
} from "@/lib/v2/demo";

type Phase = "pre" | "live" | "settled";

const TOOLS: { kind: EventKind; label: string }[] = [
  { kind: "goal", label: "Goal" },
  { kind: "corner", label: "Corner" },
  { kind: "yellow", label: "Yellow card" },
  { kind: "red", label: "Red card" },
];

const LOCK_TOTAL = 11 * 60 + 8;

function LiveDot() {
  return (
    <span
      style={{ width: 7, height: 7, borderRadius: "50%", background: C.live, animation: "v2-pulse 1.2s infinite" }}
    />
  );
}

/** Score derived from revealed events, so the header can never drift from the timeline. */
function scoreAt(second: number): [number, number] {
  let h = 0;
  let a = 0;
  for (const e of MATCH_EVENTS) {
    if (e.kind !== "goal" || e.second > second) continue;
    if (e.side === "home") h++;
    else a++;
  }
  return [h, a];
}

function statsAt(second: number, side: Side) {
  const of = (kind: EventKind) =>
    MATCH_EVENTS.filter((e) => e.kind === kind && e.side === side && e.second <= second).length;
  return { g: of("goal"), y: of("yellow"), r: of("red") };
}

export function MatchScreen() {
  const [phase, setPhase] = useState<Phase>("pre");
  const [tool, setTool] = useState<EventKind>("goal");
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stake, setStake] = useState(25);
  const [lockLeft, setLockLeft] = useState(LOCK_TOTAL);

  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(8);
  const [calls, setCalls] = useState<Record<string, FlashCall>>({});

  const nextId = useRef(1);

  // Pre-match lock countdown.
  useEffect(() => {
    if (phase !== "pre") return;
    const t = setInterval(() => setLockLeft((v) => (v <= 0 ? 0 : v - 1)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Replay clock. Recorded match, played at real speed — the demo's whole point.
  useEffect(() => {
    if (phase !== "live" || !playing) return;
    const t = setInterval(() => {
      setNow((v) => Math.min(MATCH_SECONDS, v + speed));
    }, 1000);
    return () => clearInterval(t);
  }, [phase, playing, speed]);

  useEffect(() => {
    if (phase === "settled") setNow(MATCH_SECONDS);
    if (phase === "pre") setNow(0);
  }, [phase]);

  const liveNow = phase === "pre" ? null : now;
  const revealed = useMemo(
    () => (phase === "pre" ? 0 : MATCH_EVENTS.filter((e) => e.second <= now).length),
    [phase, now],
  );

  const [hg, ag] = scoreAt(phase === "pre" ? -1 : now);
  const hs = statsAt(now, "home");
  const as = statsAt(now, "away");

  const selected = markers.find((m) => m.id === selectedId) ?? null;

  const place = (side: Side, second: number) => {
    const id = `m${nextId.current++}`;
    setMarkers((prev) => [...prev, { id, kind: tool, side, second }]);
    setSelectedId(id);
  };

  const move = (id: string, second: number, side: Side) =>
    setMarkers((prev) => prev.map((m) => (m.id === id ? { ...m, second, side } : m)));

  const nudge = (delta: number) =>
    setMarkers((prev) =>
      prev.map((m) =>
        m.id === selectedId
          ? { ...m, second: Math.max(0, Math.min(MATCH_SECONDS, m.second + delta)) }
          : m,
      ),
    );

  useEffect(() => {
    if (!selectedId || phase !== "pre") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudge(-1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        nudge(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div style={{ padding: "16px 26px 34px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link
          href="/v2"
          style={{ color: C.muted, fontSize: 13, fontWeight: 600, textDecoration: "none" }}
        >
          ← Markets
        </Link>
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            border: `1px solid ${C.line}`,
            borderRadius: 7,
            padding: "3px 5px 3px 11px",
          }}
        >
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: C.faint }}>DEMO</span>
          {(["pre", "live", "settled"] as Phase[]).map((p) => (
            <button
              key={p}
              onClick={() => setPhase(p)}
              style={{
                border: "none",
                borderRadius: 5,
                padding: "4px 11px",
                fontSize: 11.5,
                fontWeight: 600,
                background: phase === p ? C.ink : "transparent",
                color: phase === p ? C.white : C.ink2,
              }}
            >
              {p === "pre" ? "Pre-match" : p === "live" ? "Live" : "Settled"}
            </button>
          ))}
          {phase === "live" && (
            <>
              <span style={{ width: 1, height: 16, background: C.line, margin: "0 3px" }} />
              {[1, 8, 60].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  style={{
                    ...num,
                    border: "none",
                    borderRadius: 5,
                    padding: "4px 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    background: speed === s ? C.surface : "transparent",
                    color: speed === s ? C.ink : C.muted,
                  }}
                >
                  {s}×
                </button>
              ))}
              <button
                onClick={() => setPlaying((p) => !p)}
                style={{
                  border: "none",
                  borderRadius: 5,
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  background: C.ink,
                  color: C.white,
                }}
              >
                {playing ? "Pause" : "Play"}
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HOME.flag} alt="" width={44} height={29} style={{ borderRadius: 3, boxShadow: "0 0 0 1px rgba(22,24,29,0.15)" }} />
          <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>{HOME.name}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 130 }}>
          <span style={{ ...num, fontSize: 36, fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1 }}>
            {phase === "pre" ? "vs" : `${hg} – ${ag}`}
          </span>
          {phase === "pre" && (
            <span style={{ fontSize: 10.5, color: C.muted, letterSpacing: "0.04em" }}>
              KICKOFF IN <span style={{ ...num, fontWeight: 700, color: C.ink }}>{mmss(lockLeft)}</span>
            </span>
          )}
          {phase === "live" && (
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: C.live }}>
              <LiveDot /> LIVE <span style={{ ...num, color: C.ink }}>{mmss(now)}</span>
            </span>
          )}
          {phase === "settled" && (
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: C.ink2 }}>
              FULL TIME · AET · SETTLED
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>{AWAY.name}</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={AWAY.flag} alt="" width={44} height={29} style={{ borderRadius: 3, boxShadow: "0 0 0 1px rgba(22,24,29,0.15)" }} />
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.7, textAlign: "right", letterSpacing: "0.02em" }}>
          {FIXTURE.competition}
          <br />
          {FIXTURE.venue} · {FIXTURE.attendance} · Ref: {FIXTURE.referee}
        </div>
      </div>

      <div style={{ display: "flex", gap: 26, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 600px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {phase === "pre" && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <Segmented
                value={tool}
                onChange={setTool}
                options={TOOLS.map((t) => ({
                  value: t.kind,
                  label: t.label,
                  icon: (active: boolean) => (
                    <EventIcon kind={t.kind} size={15} color={active ? C.white : C.ink2} />
                  ),
                }))}
              />
              <span style={{ fontSize: 12, color: C.muted }}>Pick a tool, then click a lane. Drag to retime.</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 12.5, color: C.muted, fontStyle: "italic", fontWeight: 500 }}>
                Paint the match before it happens.
              </span>
            </div>
          )}

          {phase === "live" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
                borderBottom: `1px solid ${C.line}`,
                paddingBottom: 11,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: C.live }}>
                <LiveDot />
                <span style={{ ...num, fontSize: 15, color: C.ink }}>{mmss(now)}</span>
              </span>
              <span style={{ width: 1, height: 18, background: C.line }} />
              {(
                [
                  [HOME.code, hs],
                  [AWAY.code, as],
                ] as const
              ).map(([code, s]) => (
                <span key={code} style={{ fontSize: 12, color: C.ink2, display: "flex", gap: 8, alignItems: "center" }}>
                  <b style={{ letterSpacing: "0.04em" }}>{code}</b>
                  <BallIcon size={14} color={C.ink2} />
                  <b style={num}>{s.g}</b>
                  <YellowCardIcon size={14} color={C.ink2} />
                  <b style={num}>{s.y}</b>
                  <RedCardIcon size={14} color={C.ink2} />
                  <b style={num}>{s.r}</b>
                </span>
              ))}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: C.ink2, fontWeight: 600 }}>
                Recorded feed · replay {speed}×
              </span>
            </div>
          )}

          {phase === "settled" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                borderBottom: `1px solid ${C.line}`,
                paddingBottom: 11,
                fontSize: 12.5,
                fontWeight: 600,
                color: C.ink2,
              }}
            >
              Full time · Argentina 3 – 1 Switzerland (AET) · pot settled on-chain by Merkle proof
            </div>
          )}

          <Timeline
            markers={markers}
            selectedId={selectedId}
            tool={tool}
            onPlace={phase === "pre" ? place : null}
            onMove={move}
            onSelect={setSelectedId}
            now={liveNow}
            revealed={revealed}
          />

          {selected && phase === "pre" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <EventIcon kind={selected.kind} size={16} color={team(selected.side).color} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                {TOOLS.find((t) => t.kind === selected.kind)?.label} · {team(selected.side).code}
              </span>
              <div style={{ display: "flex", alignItems: "stretch", border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden" }}>
                <button
                  onClick={() => nudge(-1)}
                  style={{ ...num, border: "none", background: C.surface, padding: "4px 10px", fontSize: 11, fontWeight: 700, color: C.ink2, borderRight: `1px solid ${C.line}` }}
                >
                  −1s
                </button>
                <span style={{ ...num, display: "flex", alignItems: "center", padding: "0 12px", fontSize: 14, fontWeight: 700, minWidth: 62, justifyContent: "center" }}>
                  {mmss(selected.second)}
                </span>
                <button
                  onClick={() => nudge(1)}
                  style={{ ...num, border: "none", background: C.surface, padding: "4px 10px", fontSize: 11, fontWeight: 700, color: C.ink2, borderLeft: `1px solid ${C.line}` }}
                >
                  +1s
                </button>
              </div>
              <span style={{ fontSize: 10.5, color: C.muted }}>
                settles {windowFor(selected.second).label} · ← → keys nudge
              </span>
              <button
                onClick={() => {
                  setMarkers((prev) => prev.filter((m) => m.id !== selectedId));
                  setSelectedId(null);
                }}
                style={{ border: "none", background: "none", color: C.muted, fontSize: 11.5, fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 2 }}
              >
                Remove
              </button>
            </div>
          )}

          {phase === "settled" && <SettlementPanel />}
        </div>

        <div
          style={{
            flex: "0 1 330px",
            minWidth: 290,
            position: "sticky",
            top: 12,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {phase === "live" && <FlashRail now={now} calls={calls} onCall={(c) => setCalls((p) => ({ ...p, [c.marketId]: c }))} />}

          {phase === "pre" && (
            <div
              style={{
                background: lockLeft <= 60 ? C.live : C.ink,
                borderRadius: 10,
                padding: "15px 17px",
                color: C.white,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                transition: "background 0.4s",
              }}
            >
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em", opacity: 0.7 }}>
                ENTRIES CLOSE AT KICKOFF
              </span>
              <span style={{ ...num, fontSize: 38, fontWeight: 700, lineHeight: 1 }}>{mmss(lockLeft)}</span>
              <div style={{ height: 3, background: "rgba(255,255,255,0.2)", borderRadius: 2, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${(lockLeft / LOCK_TOTAL) * 100}%`,
                    background: C.white,
                    borderRadius: 2,
                    transition: "width 1s linear",
                  }}
                />
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", paddingBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em" }}>YOUR CALLS</span>
              <span style={{ ...num, fontSize: 11, color: C.muted }}>{markers.length}</span>
            </div>

            {markers.length === 0 && (
              <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, paddingBottom: 12 }}>
                No calls yet. Pick a tool above and click a lane to place one — you can place as many as you like.
              </div>
            )}

            {markers.map((m) => {
              const t = team(m.side);
              const w = windowFor(m.second);
              const isSel = m.id === selectedId;
              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedId(m.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    borderLeft: `2px solid ${isSel ? t.color : "transparent"}`,
                    borderBottom: `1px solid ${C.line2}`,
                    padding: "9px 4px 9px 9px",
                  }}
                >
                  <EventIcon kind={m.kind} size={15} color={t.color} />
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: t.color }}>
                      {TOOLS.find((x) => x.kind === m.kind)?.label} · {t.code}
                    </span>
                    <span style={{ fontSize: 10, color: C.muted }}>window {w.label}</span>
                  </span>
                  <span style={{ ...num, fontSize: 13, fontWeight: 700 }}>{mmss(m.second)}</span>
                </button>
              );
            })}

            {phase === "pre" && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 0 12px" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Stake per call</span>
                    <span style={{ fontSize: 10, color: C.muted }}>devnet USDT · 1–100</span>
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={stake}
                    onChange={(e) => setStake(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                    style={{
                      ...num,
                      width: 68,
                      border: `1px solid ${C.line}`,
                      borderRadius: 6,
                      padding: "8px 10px",
                      fontSize: 14,
                      fontWeight: 700,
                      textAlign: "right",
                    }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${C.line2}`, paddingTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: C.muted }}>Total stake</span>
                    <span style={{ ...num, fontWeight: 700 }}>{(markers.length * stake).toFixed(2)} USDT</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: C.muted }}>Projected if all land</span>
                    <span style={{ ...num, fontWeight: 800 }}>
                      {(markers.length * stake * 2.83).toFixed(2)} USDT
                    </span>
                  </div>
                  <span style={{ fontSize: 10, color: C.muted, lineHeight: 1.6, paddingTop: 2 }}>
                    Accuracy-weighted: payout scales with how close you are and how few others called the same window.
                    Exact and lonely pays most.
                  </span>
                </div>

                <div
                  style={{
                    marginTop: 14,
                    border: `1px solid ${C.line}`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontSize: 11,
                    color: C.ink2,
                    lineHeight: 1.6,
                  }}
                >
                  You call the <b>exact second</b>. On-chain proofs settle on <b>5-minute windows</b> — your call wins
                  the window it falls in. Both are always shown.
                </div>

                <button
                  disabled={markers.length === 0}
                  style={{
                    marginTop: 14,
                    border: "none",
                    borderRadius: 8,
                    padding: "12px 16px",
                    fontSize: 13.5,
                    fontWeight: 700,
                    background: markers.length === 0 ? C.line2 : C.ink,
                    color: markers.length === 0 ? C.faint : C.white,
                    cursor: markers.length === 0 ? "default" : "pointer",
                  }}
                >
                  {markers.length === 0 ? "Place a call to continue" : "Connect Wallet to place calls"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
