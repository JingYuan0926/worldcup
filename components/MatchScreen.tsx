"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { C, num } from "@/lib/tokens";
import { BallIcon, CornerIcon, EventIcon, RedCardIcon, YellowCardIcon, type EventKind } from "@/components/Icons";
import { Segmented } from "@/components/Segmented";
import { Timeline, type Marker } from "@/components/Timeline";
import { BetPanel } from "@/components/BetPanel";
import { SettlementPanel } from "@/components/SettlementPanel";
import { usePools } from "@/lib/usePools";
import { FlashMarket } from "@/components/FlashMarket";
import { useDemo } from "@/lib/useDemo";
import { FLASH_DROP_SECOND, FLASH_POOL, GOAL_POOLS, NEVER_BUCKET, bucketRange } from "@/lib/pools";
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
} from "@/lib/demo";

type Phase = "pre" | "live" | "settled";

/**
 * Only goals are stakeable — they are the money path (lib/pools.ts), and
 * `callsFrom` in BetPanel ignores every non-goal marker. The corner and card
 * tools are here so the lane can be painted with the full match shape, but
 * placing one is display-only: it never becomes a pool call.
 */
const TOOLS: { kind: EventKind; label: string }[] = [
  { kind: "goal", label: "Goal" },
  { kind: "yellow", label: "Yellow" },
  { kind: "red", label: "Red" },
  { kind: "corner", label: "Corner" },
];

const LOCK_TOTAL = 11 * 60 + 8;

/** Same bucketing the chain settles on — see lib/pools.ts. */
const bucketOfSecond = (second: number) => Math.min(18, Math.floor(second / 300));

/** Inset around the timeline inside its strip over the video. */
const PAD = 10;

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
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [speed, setSpeed] = useState(8);

  const nextId = useRef(1);
  /** Guards the auto-settle: the clock can tick past full time more than once. */
  const autoSettled = useRef(false);

  /** Fires once per room: the drop drags the speed down, it must not fight the user. */
  const flashDropped = useRef(false);
  /** The room the board is currently drawn for. */
  const shownFixture = useRef(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoFailed, setVideoFailed] = useState(false);

  const demo = useDemo();
  const { pools, refresh } = usePools(demo.fixtureId);
  /** Chain work in flight — the switcher must not fire twice into a 40s reset. */
  const busyChain = demo.resetting || demo.settling;
  const { publicKey } = useWallet();

  /**
   * Pull this wallet's on-chain entries onto the timeline.
   *
   * Without this the lanes only ever show markers you clicked this session: place
   * calls, reload, and your money is still staked but the timeline looks empty.
   *
   * A hydrated marker sits at the midpoint of its settled bucket, because the
   * midpoint is all the chain knows — `enter` stores the 5-minute bucket, and the
   * exact second you dragged to only ever lived in this component. It carries its
   * `poolIndex` so its pool is never re-derived from that approximate position.
   */
  useEffect(() => {
    const me = publicKey?.toBase58();
    if (!me) return;
    // Nothing to mirror while the room is being rebuilt — and hydrating from a
    // half-built one would put balls on the board the user never placed.
    if (demo.resetting) return;

    setMarkers((prev) => {
      const next = [...prev];
      let changed = false;

      for (const gp of GOAL_POOLS) {
        const entry = pools[gp.poolIndex]?.entries.find((e) => e.wallet === me);
        if (!entry) continue;
        const id = `chain-${gp.poolIndex}`;
        if (next.some((m) => m.id === id)) continue;

        const { start, end } = bucketRange(entry.guess);
        // A NEVER call has no place on a time axis — it shows in the panel only.
        if (entry.guess >= NEVER_BUCKET) continue;

        // Drop any unstaked marker that was standing in for this pool, so a call
        // placed this session is replaced by the confirmed on-chain one.
        const dupe = next.findIndex(
          (m) => !m.staked && m.side === gp.side && bucketOfSecond(m.second) === entry.guess,
        );
        if (dupe >= 0) next.splice(dupe, 1);

        next.push({
          id,
          kind: "goal",
          side: gp.side,
          second: Math.floor((start + end) / 2),
          poolIndex: gp.poolIndex,
          staked: true,
        });
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [pools, publicKey, demo.resetting]);

  /**
   * Staked lamports per bucket, per lane — the histogram behind each lane. Summed
   * across that team's goal pools: the lane answers "when does ARG score", so all
   * the ARG ordinals contribute to the same picture of where the crowd is.
   * NEVER (bucket 20) is excluded — it has no position on a time axis.
   */
  const crowd = useMemo(() => {
    const empty = () => Array.from({ length: NEVER_BUCKET }, () => 0);
    const out = { home: empty(), away: empty() };
    for (const gp of GOAL_POOLS) {
      const pool = pools[gp.poolIndex];
      if (!pool) continue;
      for (const e of pool.entries) {
        if (e.guess < 0 || e.guess >= NEVER_BUCKET) continue;
        out[gp.side][e.guess] += e.stake;
      }
    }
    return out;
  }, [pools]);

  /**
   * The DEMO switcher is not just a view toggle any more — it drives the chain.
   *
   * Pre-match rebuilds the room (a settled pool can never reopen, so "again" means
   * a fresh fixture), and Settled posts the real outcomes. Both are guarded: a
   * reset is 20–40s of devnet round-trips, so re-clicking Pre-match on an already
   * fresh, unsettled room does nothing rather than burning a minute on stage.
   */
  const handlePhaseChange = async (p: Phase) => {
    setPhase(p);
    if (p === "settled") setNow(MATCH_SECONDS);
    if (p === "pre") setNow(0);
    if (p !== "live") setTimelineOpen(false);

    if (p === "pre") {
      const settled = Object.values(pools).some((pool) => pool && pool.state !== 0);
      const locked = Object.values(pools).some(
        (pool) => pool && Date.now() / 1000 >= pool.lockTs,
      );
      const empty = Object.values(pools).every((pool) => !pool);
      if (settled || locked || empty) {
        setMarkers([]);
        setSelectedId(null);
        autoSettled.current = false;
        flashDropped.current = false;
        await demo.reset();
        await refresh();
      }
    }

    if (p === "settled") {
      const anyOpen = Object.values(pools).some((pool) => pool && pool.state === 0);
      if (anyOpen) {
        await demo.settle();
        await refresh();
      }
    }
  };

  // Pre-match lock countdown.
  useEffect(() => {
    if (phase !== "pre") return;
    const t = setInterval(() => setLockLeft((v) => (v <= 0 ? 0 : v - 1)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Live timer.
  useEffect(() => {
    if (phase !== "live" || !playing) return;
    const t = setInterval(() => {
      setNow((v) => Math.min(MATCH_SECONDS, v + speed));
    }, 1000);
    return () => clearInterval(t);
  }, [phase, playing, speed]);

  /**
   * Full time ends the demo by itself: the replay hitting MATCH_SECONDS is the
   * cue to settle, so the operator never has to reach for the switcher mid-story.
   * Guarded by a ref because `now` clamps to MATCH_SECONDS and would otherwise
   * re-fire the settle on every tick.
   */
  useEffect(() => {
    if (phase !== "live" || now < MATCH_SECONDS || autoSettled.current) return;
    autoSettled.current = true;
    void handlePhaseChange("settled");
    // handlePhaseChange is recreated each render; the ref is what actually guards this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, now]);

  /* ─────────────────────────────────────────────────────── video sync ──── */

  /**
   * The match clock owns the video, not the other way round.
   *
   * The footage is 150 minutes long but the match clock runs to 124', so the two
   * are mapped proportionally rather than 1:1 — otherwise the picture drifts
   * further from the timeline with every minute.
   */
  const videoTimeFor = useCallback(
    (second: number) => (videoDuration ? (second / MATCH_SECONDS) * videoDuration : 0),
    [videoDuration],
  );

  /**
   * How fast the video must run to keep pace, and the ceiling it runs into.
   *
   * Browsers clamp `playbackRate` to 16× (Chrome and Safari both throw or clamp
   * above it), and the footage/clock ratio means even 8× demo speed asks for ~9.7×.
   * At 60× the ask is ~73× — impossible to *play*. So the rate is clamped and the
   * drift correction below carries the rest by seeking: at 60× the picture is
   * effectively scrubbed rather than played, which is the honest limit of the API.
   */
  const desiredRate = videoDuration ? (speed * videoDuration) / MATCH_SECONDS : speed;
  const cappedRate = Math.max(0.0625, Math.min(16, desiredRate));

  // Play only while the replay is running.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || videoFailed) return;
    if (phase === "live" && playing) void v.play().catch(() => {});
    else v.pause();
  }, [phase, playing, videoFailed]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || videoFailed) return;
    try {
      v.playbackRate = cappedRate;
    } catch {
      // Some browsers throw rather than clamp; the seek correction still holds sync.
      v.playbackRate = 1;
    }
  }, [cappedRate, videoFailed]);

  // Pull the picture back onto the clock whenever it drifts. This is what makes
  // 60× work at all, and what re-seats the video after a phase jump.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || videoFailed || !videoDuration) return;
    const want = videoTimeFor(now);
    // Tolerance scales with speed: at 1× a half-second slip is visible, at 60×
    // chasing every frame would seek constantly and never render anything.
    const tolerance = Math.max(0.4, desiredRate * 0.35);
    if (Math.abs(v.currentTime - want) > tolerance) v.currentTime = want;
  }, [now, videoDuration, videoFailed, videoTimeFor, desiredRate]);

  /**
   * The flash market drops at 20' and pulls the replay down to 1×.
   *
   * At 60× the whole match is two minutes, so a market that opens and closes
   * in-play would be gone before anyone read the question. Dropping to real time is
   * the point of the beat: the room stops, reads, and calls. The ref makes it fire
   * once — otherwise every tick past 20' would stamp the speed back to 1× and the
   * operator could never wind it forward again.
   */
  const flashLive = phase === "live" && now >= FLASH_DROP_SECOND;

  /**
   * The card outlives the drop. It has to: once the market settles, this is the only
   * place the flash payout can be read or claimed from, and Settled is exactly when
   * you want to. Hiding it with the live phase left money stranded on-chain.
   */
  const flashPool = pools[FLASH_POOL.poolIndex] ?? null;
  const flashVisible = flashLive || (phase === "settled" && flashPool !== null);

  useEffect(() => {
    if (!flashLive || flashDropped.current) return;
    flashDropped.current = true;
    setSpeed(1);
  }, [flashLive]);

  /**
   * A new room wipes the board.
   *
   * The fixture can change underneath us — someone resets from a CLI, or another
   * tab does — and markers hydrated from the old room would silently re-map onto
   * the new room's pools. Clearing on change is the only safe read.
   */
  useEffect(() => {
    if (!demo.fixtureId) return;
    if (shownFixture.current === demo.fixtureId) return;
    if (shownFixture.current !== 0) {
      setMarkers([]);
      setSelectedId(null);
      autoSettled.current = false;
      flashDropped.current = false;
    }
    shownFixture.current = demo.fixtureId;
  }, [demo.fixtureId]);

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

  /**
   * Drop a call from the board. Refuses staked markers: they mirror an on-chain
   * entry the program cannot cancel, so removing one here would only desync the
   * timeline from where the money actually is.
   */
  const removeMarker = (id: string) => {
    setMarkers((prev) => prev.filter((m) => m.id === id ? m.staked === true : true));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  const move = (id: string, second: number, side: Side) =>
    setMarkers((prev) => prev.map((m) => (m.id === id ? { ...m, second, side } : m)));

  const nudge = (delta: number) =>
    setMarkers((prev) =>
      prev.map((m) =>
        // Staked markers are frozen: the entry they mirror is immutable on-chain,
        // so retiming one here would only lie about where the money is. The drag
        // handler already refuses — the buttons and arrow keys must agree.
        m.id === selectedId && !m.staked
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

  useEffect(() => {
    if (!timelineOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTimelineOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timelineOpen]);

  const renderTimeline = (overlay: boolean) => (
    <Timeline
      markers={markers}
      selectedId={selectedId}
      tool={tool}
      onPlace={phase === "pre" ? place : null}
      onMove={move}
      onSelect={setSelectedId}
      now={liveNow}
      revealed={revealed}
      crowd={crowd}
      overlay={overlay}
    />
  );

  return (
    <div style={{ padding: "16px 26px 34px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link
          href="/"
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
              onClick={() => void handlePhaseChange(p)}
              disabled={busyChain}
              style={{
                border: "none",
                borderRadius: 5,
                padding: "4px 11px",
                fontSize: 11.5,
                fontWeight: 600,
                background: phase === p ? C.ink : "transparent",
                color: busyChain ? C.faint : phase === p ? C.white : C.ink2,
                cursor: busyChain ? "default" : "pointer",
              }}
            >
              {p === "pre" ? "Pre-match" : p === "live" ? "Live" : "Settled"}
            </button>
          ))}
          {busyChain && (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 10.5,
                fontWeight: 600,
                color: C.ink2,
                paddingLeft: 4,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: C.ink,
                  animation: "v2-pulse 1.2s infinite",
                }}
              />
              {demo.resetting ? "rebuilding pools on devnet…" : "settling on-chain…"}
            </span>
          )}
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
                    <EventIcon kind={t.kind} size={15} />
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
                  <BallIcon size={14} />
                  <b style={num}>{s.g}</b>
                  <YellowCardIcon size={14} />
                  <b style={num}>{s.y}</b>
                  <RedCardIcon size={14} />
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

          {phase !== "live" && renderTimeline(false)}

          {selected && phase === "pre" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <EventIcon kind={selected.kind} size={16} />
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
                {selected.kind === "goal"
                  ? `settles ${windowFor(selected.second).label} · ← → keys nudge`
                  : "display only · ← → keys nudge"}
              </span>
              <button
                onClick={() => selectedId && removeMarker(selectedId)}
                style={{ border: "none", background: "none", color: C.muted, fontSize: 11.5, fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 2 }}
              >
                Remove
              </button>
            </div>
          )}

          {phase === "settled" && <SettlementPanel pools={pools} />}

          {phase === "live" && (
          <div
            style={{
              marginTop: 10,
              border: `1px solid ${C.line}`,
              borderRadius: 10,
              background: C.white,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.02em" }}>FULL MATCH REPLAY</span>
              <button
                onClick={() => setTimelineOpen((v) => !v)}
                style={{
                  border: `1px solid ${timelineOpen ? C.ink : C.line}`,
                  borderRadius: 6,
                  padding: "5px 11px",
                  fontSize: 11,
                  fontWeight: 700,
                  background: timelineOpen ? C.ink : C.white,
                  color: timelineOpen ? C.white : C.ink2,
                }}
              >
                {timelineOpen ? "Hide timeline" : "Show timeline"}
              </button>
            </div>

            <div
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: "16/9",
                background: "#0d0e12",
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                boxShadow: "inset 0 0 20px rgba(0,0,0,0.8)",
              }}
            >
              {/*
                No `controls`: the match clock drives the video, so a scrub bar
                would just be a second, disagreeing source of truth. Muted because
                audio at 8× is noise — and because autoplay needs it.
              */}
              <video
                ref={videoRef}
                src="/game.mov"
                muted
                playsInline
                preload="metadata"
                disablePictureInPicture
                controlsList="nodownload nofullscreen noremoteplayback"
                onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration)}
                onError={() => setVideoFailed(true)}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  background: "#0d0e12",
                  display: videoFailed ? "none" : "block",
                }}
              />

              {videoFailed && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: C.faint, padding: 20, textAlign: "center" }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>This browser cannot play /game.mov</span>
                  <span style={{ fontSize: 11, opacity: 0.7, maxWidth: 380, lineHeight: 1.5 }}>
                    It is HEVC in a QuickTime container. Safari plays it; Chrome usually
                    will not. Transcode to H.264 MP4 — see docs/demo-runbook.md.
                  </span>
                </div>
              )}

              {timelineOpen && <TimelineStrip>{renderTimeline(true)}</TimelineStrip>}
            </div>
          </div>
          )}
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

          {flashVisible && (
            <FlashMarket
              pool={flashPool}
              fixtureId={demo.fixtureId}
              onRefresh={refresh}
            />
          )}

          <BetPanel
            markers={markers}
            pools={pools}
            fixtureId={demo.fixtureId}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRemove={removeMarker}
            onRefresh={refresh}
          />
        </div>
      </div>

    </div>
  );
}

/**
 * The timeline has a fixed natural height (~250px) but the strip it sits in is a
 * fraction of the video, whose height follows the panel width. Measure both and
 * scale to fit rather than letting it clip.
 */
function TimelineStrip({ children }: { children: React.ReactNode }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => {
      const natural = innerRef.current?.scrollHeight ?? 0;
      const avail = box.clientHeight - PAD * 2;
      setScale(natural > 0 && avail > 0 ? Math.min(1, avail / natural) : 1);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={boxRef}
      style={{
        position: "absolute",
        left: "5%",
        right: "5%",
        bottom: 18,
        height: "24%",
        minHeight: 120,
        background: C.white,
        border: `1px solid ${C.hair}`,
        borderRadius: 16,
        boxShadow: "0 22px 55px rgba(2,6,23,0.7)",
        overflow: "hidden",
        animation: "v2-sheet-up 0.22s ease-out",
      }}
    >
      <div
        ref={innerRef}
        style={{
          position: "absolute",
          top: PAD,
          left: PAD,
          width: `calc((100% - ${PAD * 2}px) / ${scale})`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}
