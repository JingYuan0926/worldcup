"use client";

import { useState } from "react";
import Link from "next/link";
import { C, num } from "@/lib/v2/tokens";

/**
 * The chrome is loud and the data is quiet: the FIFA ribbons live out here on a
 * fixed backdrop, and every pixel of app content sits inside one restrained
 * white panel laid on top of it.
 */
function Backdrop() {
  return (
    <div style={{ position: "absolute", inset: 0, background: C.night }}>
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        aria-hidden="true"
      >
        <path d="M-200,760 C300,380 900,1050 1600,430" stroke="#16247e" strokeWidth="220" fill="none" strokeLinecap="round" />
        <path d="M-150,280 C380,60 860,540 1620,170" stroke="#1d4ed8" strokeWidth="110" fill="none" strokeLinecap="round" opacity="0.9" />
        <path d="M980,-120 C760,320 1340,480 1520,940" stroke="#7c3aed" strokeWidth="130" fill="none" strokeLinecap="round" opacity="0.85" />
        <path d="M-120,880 C480,720 1020,960 1580,640" stroke="#f97316" strokeWidth="50" fill="none" strokeLinecap="round" />
        <path d="M-160,520 C340,260 780,700 1620,330" stroke="#38bdf8" strokeWidth="28" fill="none" strokeLinecap="round" />
        <path d="M-80,120 C500,300 900,-60 1560,320" stroke="#a855f7" strokeWidth="20" fill="none" strokeLinecap="round" opacity="0.8" />
      </svg>
    </div>
  );
}

function TopBar() {
  const [connected, setConnected] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "13px 26px",
        borderBottom: `1px solid ${C.line}`,
        flexShrink: 0,
      }}
    >
      <Link href="/v2" style={{ display: "flex", alignItems: "baseline", gap: 5, textDecoration: "none" }}>
        <span style={{ fontWeight: 900, fontSize: 19, letterSpacing: "-0.04em", color: C.ink }}>EXACT</span>
        <span style={{ fontWeight: 900, fontSize: 19, letterSpacing: "-0.04em", color: C.muted }}>MATCH</span>
      </Link>
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.1em",
          color: C.muted,
          border: `1px solid ${C.line}`,
          borderRadius: 4,
          padding: "3px 7px",
        }}
      >
        DEVNET
      </span>
      <div style={{ flex: 1 }} />
      {connected ? (
        <button
          onClick={() => setConnected(false)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: C.white,
            border: `1px solid ${C.line}`,
            borderRadius: 7,
            padding: "7px 14px",
            fontSize: 12.5,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.ink }} />
          <span style={{ ...num, color: C.ink, fontWeight: 600 }}>7xKQ…9fWm</span>
          <span style={{ ...num, color: C.muted }}>240.50 USDT</span>
        </button>
      ) : (
        <button
          onClick={() => setConnected(true)}
          style={{
            background: C.ink,
            color: C.white,
            border: "none",
            borderRadius: 7,
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Connect Wallet
        </button>
      )}
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        fontFamily: "var(--v2-sans), -apple-system, sans-serif",
        color: C.ink,
      }}
    >
      <Backdrop />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "max(80vw, min(100vw - 16px, 720px))",
            height: "min(90vh, calc(100vh - 20px))",
            background: C.white,
            borderRadius: 16,
            boxShadow: "0 40px 90px rgba(2,6,23,0.6)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <TopBar />
          <div className="v2-scroll" style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
