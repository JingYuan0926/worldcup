"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { C, num } from "@/lib/tokens";
import { CARDS, FILTERS, LEAGUES, SPORTS, sparkPoints, type MarketCard } from "@/lib/markets";

function SoonTag() {
  return (
    <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", color: C.faint }}>
      SOON
    </span>
  );
}

function LiveDot() {
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: C.live,
        animation: "v2-pulse 1.2s infinite",
      }}
    />
  );
}

function Card({ card, onOpen }: { card: MarketCard; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border: `1px solid ${hover ? C.faint : C.line}`,
        borderRadius: 10,
        padding: 15,
        display: "flex",
        flexDirection: "column",
        gap: 11,
        cursor: "pointer",
        background: C.white,
        transition: "border-color 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            color: C.muted,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {card.comp}
        </span>
        {card.live ? (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              fontWeight: 700,
              color: C.live,
            }}
          >
            <LiveDot />
            LIVE <span style={num}>{card.clock}</span>
          </span>
        ) : (
          <span
            style={{
              ...num,
              fontSize: 11,
              fontWeight: 600,
              color: card.urgent ? C.ink : C.muted,
            }}
          >
            {card.when}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {[
          { name: card.homeName, flag: card.homeFlag, score: card.homeScore },
          { name: card.awayName, flag: card.awayFlag, score: card.awayScore },
        ].map((row) => (
          <div key={row.name} style={{ display: "flex", alignItems: "center", gap: 9 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={row.flag}
              alt=""
              width={22}
              height={15}
              style={{ borderRadius: 2, boxShadow: `0 0 0 1px rgba(22,24,29,0.12)`, flexShrink: 0 }}
            />
            <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.01em", flex: 1 }}>
              {row.name}
            </span>
            <span style={{ ...num, fontSize: 14, fontWeight: 700 }}>{row.score}</span>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderTop: `1px solid ${C.line2}`,
          paddingTop: 10,
        }}
      >
        <span style={{ ...num, fontSize: 11.5, color: C.ink2 }}>{card.volume} USDT</span>
        <span style={{ fontSize: 11.5, color: C.muted }}>{card.markets}</span>
        <div style={{ flex: 1 }} />
        <svg width={72} height={20} viewBox="0 0 96 20" aria-hidden="true">
          <polyline points={sparkPoints(card.spark)} fill="none" stroke={C.faint} strokeWidth={1.5} />
        </svg>
      </div>
    </div>
  );
}

export function MarketsScreen() {
  const router = useRouter();
  const [sport, setSport] = useState("soccer");
  const [league, setLeague] = useState("wc26");
  const [filter, setFilter] = useState("All");
  const [q, setQ] = useState("");

  const cards = useMemo(() => {
    const term = q.trim().toLowerCase();
    return CARDS.filter((c) => {
      if (filter === "Live" && !c.live) return false;
      if (filter === "Upcoming" && (c.live || c.when === "Settled")) return false;
      if (!term) return true;
      return (
        c.homeName.toLowerCase().includes(term) ||
        c.awayName.toLowerCase().includes(term) ||
        c.comp.toLowerCase().includes(term)
      );
    });
  }, [filter, q]);

  return (
    <div style={{ padding: "20px 26px 34px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {SPORTS.map((s) => {
          const active = s.id === sport && !s.soon;
          return (
            <button
              key={s.id}
              disabled={s.soon}
              onClick={() => !s.soon && setSport(s.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                borderRadius: 7,
                padding: "7px 13px",
                fontSize: 13,
                fontWeight: 600,
                border: `1px solid ${active ? C.ink : C.line}`,
                background: active ? C.ink : C.white,
                color: active ? C.white : C.ink,
                opacity: s.soon ? 0.5 : 1,
                cursor: s.soon ? "default" : "pointer",
              }}
            >
              {s.label}
              {s.soon && <SoonTag />}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 22, borderBottom: `1px solid ${C.line}`, overflowX: "auto" }}>
        {LEAGUES.map((l) => {
          const active = l.id === league && !l.soon;
          return (
            <button
              key={l.id}
              disabled={l.soon}
              onClick={() => !l.soon && setLeague(l.id)}
              style={{
                background: "none",
                border: "none",
                padding: "2px 0 10px",
                fontSize: 13,
                whiteSpace: "nowrap",
                fontWeight: active ? 700 : 500,
                color: active ? C.ink : C.muted,
                borderBottom: `2px solid ${active ? C.ink : "transparent"}`,
                opacity: l.soon ? 0.5 : 1,
                display: "flex",
                gap: 6,
                alignItems: "center",
                cursor: l.soon ? "default" : "pointer",
              }}
            >
              {l.label}
              {l.soon && <SoonTag />}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search matches, teams, leagues"
          style={{
            flex: "1 1 240px",
            maxWidth: 380,
            border: `1px solid ${C.line}`,
            borderRadius: 7,
            padding: "9px 14px",
            fontSize: 13,
            color: C.ink,
          }}
        />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTERS.map((f) => {
            const active = f === filter;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  borderRadius: 7,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  border: `1px solid ${active ? C.ink : C.line}`,
                  background: active ? C.ink : C.white,
                  color: active ? C.white : C.ink2,
                }}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {cards.map((c) => (
          <Card key={c.fixtureId} card={c} onOpen={() => router.push(`/match/${c.fixtureId}`)} />
        ))}
      </div>

      {cards.length === 0 && (
        <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: C.muted }}>
          No matches for that filter.
        </div>
      )}
    </div>
  );
}
