"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { C, num } from "@/lib/v2/tokens";
import { BallIcon, CheckIcon, VoidIcon } from "@/components/v2/Icons";
import {
  FLASH_ENTRY_SECONDS,
  FLASH_MARKETS,
  FLASH_MAX_MINUTES,
  NEVER,
  callWindow,
  flashActual,
  flashActualWindow,
  flashPool,
  flashQuestion,
  flashStateAt,
  mmss,
  team,
  voidsAt,
  type FlashMarket,
} from "@/lib/v2/demo";

export interface FlashCall {
  marketId: string;
  minutes: number;
  stake: number;
}

interface Props {
  now: number;
  calls: Record<string, FlashCall>;
  onCall: (call: FlashCall) => void;
}

function Head({ label, right, bg, fg }: { label: string; right: string; bg: string; fg: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 13px", background: bg, color: fg }}>
      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em" }}>{label}</span>
      <div style={{ flex: 1 }} />
      <span style={{ ...num, fontSize: 10, opacity: 0.85 }}>{right}</span>
    </div>
  );
}

function Question({ m }: { m: FlashMarket }) {
  const t = team(m.side);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={t.flag}
        alt=""
        width={24}
        height={16}
        style={{ borderRadius: 2, boxShadow: "0 0 0 1px rgba(22,24,29,0.12)", flexShrink: 0 }}
      />
      <span style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.3 }}>
        {flashQuestion(m)}
      </span>
    </div>
  );
}

/** Minutes on the track; NEVER is a separate terminal detent, not the last tick. */
function MinuteSlider({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const down = useRef(false);

  const toValue = useCallback(
    (clientX: number) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      onChange(Math.round(ratio * FLASH_MAX_MINUTES));
    },
    [onChange],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => down.current && toValue(e.clientX);
    const up = () => {
      down.current = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [toValue]);

  const on = value !== null && value !== NEVER;
  const pct = on ? (value / FLASH_MAX_MINUTES) * 100 : 0;

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={FLASH_MAX_MINUTES}
      aria-valuenow={on ? value : undefined}
      aria-label="Minutes until the next goal"
      onPointerDown={(e) => {
        down.current = true;
        toValue(e.clientX);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(Math.max(0, (on ? value : 0) - 1));
        if (e.key === "ArrowRight") onChange(Math.min(FLASH_MAX_MINUTES, (on ? value : 0) + 1));
      }}
      style={{ position: "relative", flex: 1, height: 34, cursor: "ew-resize", touchAction: "none", borderRadius: 4 }}
    >
      <div style={{ position: "absolute", left: 0, right: 0, top: 16, height: 2, background: C.hair }} />
      {Array.from({ length: FLASH_MAX_MINUTES + 1 }).map((_, i) => {
        const major = i % 5 === 0;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${(i / FLASH_MAX_MINUTES) * 100}%`,
              top: major ? 11 : 13,
              width: 1,
              height: major ? 9 : 5,
              background: C.faint,
            }}
          />
        );
      })}
      {[0, 5, 10, 15].map((mnt) => (
        <span
          key={mnt}
          style={{
            ...num,
            position: "absolute",
            left: `${(mnt / FLASH_MAX_MINUTES) * 100}%`,
            top: 22,
            transform: mnt === 0 ? "none" : mnt === 15 ? "translateX(-100%)" : "translateX(-50%)",
            fontSize: 8.5,
            color: C.faint,
          }}
        >
          {mnt}
        </span>
      ))}
      {on && (
        <div
          style={{
            position: "absolute",
            left: `${pct}%`,
            top: 10,
            transform: "translateX(-50%)",
            width: 8,
            height: 14,
            background: C.ink,
            borderRadius: 2,
          }}
        />
      )}
    </div>
  );
}

function OpenCard({ m, now, onCall }: { m: FlashMarket; now: number; onCall: (c: FlashCall) => void }) {
  const [value, setValue] = useState<number | null>(null);
  const [stake, setStake] = useState(25);

  const remaining = Math.max(0, m.lockSecond - now);
  const urgent = remaining <= 20;
  const barW = (remaining / FLASH_ENTRY_SECONDS) * 100;
  const pool = flashPool(m, now);
  const win = value !== null ? callWindow(m, value) : null;

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span
          style={{
            ...num,
            fontSize: 34,
            fontWeight: 700,
            lineHeight: 1,
            color: urgent ? C.live : C.ink,
          }}
        >
          {mmss(remaining)}
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: C.muted }}>TO ENTER</span>
        <div style={{ flex: 1 }} />
        <span style={{ ...num, fontSize: 10.5, color: C.muted }}>
          {pool.usdt} USDT · {pool.entries}
        </span>
      </div>
      <div style={{ height: 3, background: C.line2, borderRadius: 2, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${barW}%`,
            background: urgent ? C.live : C.ink,
            transition: "width 0.2s linear",
          }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <MinuteSlider value={value} onChange={setValue} />
        <button
          onClick={() => setValue(NEVER)}
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
            border: value === NEVER ? `1px solid ${C.ink}` : `1px dashed ${C.hair}`,
            background: value === NEVER ? C.ink : C.white,
            color: value === NEVER ? C.white : C.muted,
            borderRadius: 5,
            padding: "5px 9px",
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: "0.08em",
          }}
        >
          NEVER
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ ...num, fontSize: 19, fontWeight: 700 }}>
          {value === null ? "—" : value === NEVER ? "NEVER" : `${value} min`}
        </span>
        <span style={{ fontSize: 11, color: C.muted }}>
          {value === null
            ? "Slide to call it"
            : value === NEVER
              ? "settles at full time"
              : `settles ${win?.label ?? ""}`}
        </span>
        {win?.short && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: C.muted,
              border: `1px solid ${C.line}`,
              borderRadius: 3,
              padding: "1px 5px",
            }}
          >
            SHORT WINDOW
          </span>
        )}
      </div>

      <div
        style={{
          borderTop: `1px solid ${C.line2}`,
          paddingTop: 9,
          fontSize: 11.5,
          fontWeight: 600,
          lineHeight: 1.55,
        }}
      >
        The 2-minute entry window doesn&apos;t count. Your call is measured from{" "}
        <span style={num}>{mmss(m.lockSecond)}</span> — the moment entries lock. Nobody can snipe an
        attack they can already see.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <input
          type="number"
          min={1}
          max={100}
          value={stake}
          onChange={(e) => setStake(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
          style={{
            ...num,
            width: 64,
            border: `1px solid ${C.line}`,
            borderRadius: 6,
            padding: "7px 9px",
            fontSize: 13,
            fontWeight: 700,
            textAlign: "right",
          }}
        />
        <span style={{ fontSize: 10.5, color: C.muted }}>USDT</span>
        <button
          disabled={value === null}
          onClick={() => value !== null && onCall({ marketId: m.id, minutes: value, stake })}
          style={{
            flex: 1,
            border: "none",
            borderRadius: 6,
            padding: 9,
            fontSize: 12.5,
            fontWeight: 700,
            background: value === null ? C.line2 : C.ink,
            color: value === null ? C.faint : C.white,
            cursor: value === null ? "default" : "pointer",
          }}
        >
          {value === null ? "Pick a time" : "Place call"}
        </button>
      </div>
    </>
  );
}

function WatchingCard({ m, now, call }: { m: FlashMarket; now: number; call?: FlashCall }) {
  const elapsed = Math.max(0, now - m.lockSecond);
  const pool = flashPool(m, m.lockSecond);
  const win = call ? callWindow(m, call.minutes) : null;
  const passed = win !== null && now > win.endSecond;

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ ...num, fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{mmss(elapsed)}</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: C.muted }}>SINCE LOCK</span>
        <div style={{ flex: 1 }} />
        <span style={{ ...num, fontSize: 10.5, color: C.muted }}>
          {pool.usdt} USDT · {pool.entries}
        </span>
      </div>
      <div style={{ height: 3, background: C.line2, borderRadius: 2, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, (elapsed / (FLASH_MAX_MINUTES * 60)) * 100)}%`,
            background: C.ink,
            transition: "width 0.2s linear",
          }}
        />
      </div>
      <div style={{ fontSize: 11.5, color: C.ink2, lineHeight: 1.55 }}>
        Locked. The clock is running against every call in this pool.
      </div>
      {call && (
        <div style={{ fontSize: 11, fontWeight: 600, color: passed ? C.muted : C.ink }}>
          {call.minutes === NEVER
            ? "Your call: NEVER — resolves at full time"
            : passed
              ? `Your window ${win?.label} has passed`
              : `Your window ${win?.label} is still live`}
        </div>
      )}
    </>
  );
}

function VoidCard({ m, call }: { m: FlashMarket; call?: FlashCall }) {
  const at = voidsAt(m);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ fontSize: 12, color: C.ink2, lineHeight: 1.6 }}>
        {team(m.side).name} scored at <span style={num}>{at !== undefined ? mmss(at) : ""}</span> — during the entry
        window, before this market ever locked.
      </span>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          borderTop: `1px solid ${C.line2}`,
          paddingTop: 8,
          fontSize: 12,
        }}
      >
        <span style={{ color: C.muted }}>All stakes refunded</span>
        <span style={{ ...num, fontWeight: 700 }}>{call ? `${call.stake.toFixed(2)} USDT` : "—"}</span>
      </div>
      <span style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.6 }}>
        No one lost, no one won — the question stopped making sense before entries locked. Working as designed.
      </span>
    </div>
  );
}

function SettledCard({ m, call }: { m: FlashMarket; call?: FlashCall }) {
  const actual = flashActual(m);
  const actualWin = flashActualWindow(m);
  const callWin = call && call.minutes !== NEVER ? callWindow(m, call.minutes) : null;
  const won =
    call !== undefined &&
    (call.minutes === NEVER
      ? actual === NEVER
      : actualWin !== null && callWin !== null && callWin.index === actualWin.index);
  const amount = call ? (won ? call.stake * 3.1 : 0) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: won ? C.ink : C.muted }}>
        {actual === NEVER
          ? `${team(m.side).code} never scored again`
          : `${team(m.side).code} scored after ${actual.toFixed(1)} min`}
      </span>
      <span style={{ fontSize: 11.5, color: C.ink2, lineHeight: 1.55 }}>
        {actualWin ? `Settled on window ${actualWin.label}. ` : "Settled at full time. "}
        {call ? (won ? "Your call took the window." : "Your call missed the window.") : "You had no call in this pool."}
      </span>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          borderTop: `1px solid ${C.line2}`,
          paddingTop: 8,
        }}
      >
        <a href="https://explorer.solana.com/?cluster=devnet" target="_blank" rel="noopener noreferrer" style={{ ...num, fontSize: 11 }}>
          proof ↗
        </a>
        <span style={{ ...num, fontSize: 16, fontWeight: 700, color: won ? C.ink : C.muted }}>
          {won ? `+${amount.toFixed(2)}` : amount.toFixed(2)} USDT
        </span>
      </div>
    </div>
  );
}

export function FlashRail({ now, calls, onCall }: Props) {
  const live = FLASH_MARKETS.map((m) => ({ m, state: flashStateAt(m, now) })).filter(
    (x) => x.state !== null,
  );
  const active = live.filter((x) => x.state !== "settled" && x.state !== "void");
  const retired = live.filter((x) => x.state === "settled" || x.state === "void");
  const shown = [...active, ...retired.slice(-1)];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em" }}>FLASH MARKETS</span>
        <span style={{ fontSize: 10, color: C.muted }}>drop unannounced · 2 minutes to act</span>
      </div>

      {shown.length === 0 && (
        <div
          style={{
            border: `1px dashed ${C.hair}`,
            borderRadius: 10,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: C.ink2 }}>None open right now.</span>
          <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
            A market drops only when the match asks an interesting question — never in the final minutes, never right
            after a goal. When one lands you get exactly 2:00 to call it.
          </span>
        </div>
      )}

      {shown.map(({ m, state }) => {
        const call = calls[m.id];
        const headMap = {
          open: { label: "FLASH · OPEN", bg: C.ink, fg: C.white },
          watching: { label: "FLASH · LOCKED", bg: C.surface, fg: C.ink2 },
          void: { label: "FLASH · VOID", bg: C.surface, fg: C.muted },
          settled: { label: "FLASH · SETTLED", bg: C.surface, fg: C.ink2 },
        } as const;
        const head = headMap[state as keyof typeof headMap];

        return (
          <div
            key={m.id}
            style={{
              border: `1px solid ${state === "open" ? C.ink : C.line}`,
              borderRadius: 10,
              overflow: "hidden",
              background: C.white,
              animation: state === "open" ? "v2-drop-in 0.4s cubic-bezier(.2,.8,.3,1) both" : undefined,
            }}
          >
            <Head
              label={head.label}
              right={state === "open" ? `dropped ${mmss(m.dropSecond)}` : `locked ${mmss(m.lockSecond)}`}
              bg={head.bg}
              fg={head.fg}
            />
            <div style={{ padding: 13, display: "flex", flexDirection: "column", gap: 11 }}>
              <Question m={m} />
              {state === "open" && <OpenCard m={m} now={now} onCall={onCall} />}
              {state === "watching" && <WatchingCard m={m} now={now} call={call} />}
              {state === "void" && <VoidCard m={m} call={call} />}
              {state === "settled" && <SettledCard m={m} call={call} />}
            </div>
          </div>
        );
      })}

      {retired.length > 1 &&
        retired.slice(0, -1).map(({ m, state }) => {
          const call = calls[m.id];
          const won = state === "settled" && call !== undefined;
          return (
            <div
              key={`r-${m.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "8px 4px",
                borderBottom: `1px solid ${C.line2}`,
                opacity: 0.75,
              }}
            >
              {state === "void" ? (
                <VoidIcon size={14} color={C.muted} />
              ) : (
                <CheckIcon size={14} color={C.muted} />
              )}
              <span style={{ fontSize: 11.5, color: C.ink2, flex: 1 }}>
                {team(m.side).code} · {state === "void" ? "voided" : "settled"} at {mmss(m.lockSecond)}
              </span>
              <span style={{ ...num, fontSize: 11.5, fontWeight: 700, color: C.muted }}>
                {call ? `${call.stake.toFixed(2)}` : "—"}
              </span>
            </div>
          );
        })}
    </div>
  );
}
