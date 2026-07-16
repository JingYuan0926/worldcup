"use client";

import { useState } from "react";
import { C, num } from "@/lib/v2/tokens";
import { CheckIcon, DeniedIcon, LockIcon } from "@/components/v2/Icons";

const PROOF_JSON = `{
  "fixtureId": 18209181,
  "seq": 4471,
  "statKey": 1,
  "value": 3,
  "predicate": { "threshold": 3, "comparison": "EqualTo" },
  "updateStats": {
    "minTimestamp": 1784404800000,
    "maxTimestamp": 1784405099000
  },
  "eventStatsSubTreeRoot": "sK4Xr0…9Tq=",
  "statProof": [
    { "hash": "0x9f21…c4a1", "isRightSibling": true  },
    { "hash": "0x31aa…e07f", "isRightSibling": false }
  ],
  "mainTreeProof": [
    { "hash": "0x77bd…1e94", "isRightSibling": true  }
  ]
}`;

const LEVELS = [
  { lab: "LEAF", hash: "0x9f21…c4a1", note: "goals.P1 = 3" },
  { lab: "L1", hash: "0x31aa…e07f", note: "sibling from statProof" },
  { lab: "L2", hash: "sK4Xr0…9Tq=", note: "events_sub_tree_root" },
  { lab: "L3", hash: "0x77bd…1e94", note: "sibling from mainTreeProof" },
  { lab: "ROOT", hash: "0xb7f04c19…21d9", note: "matches on-chain root" },
];

interface PayRow {
  name: string;
  sub: string;
  amount: string;
  width: number;
  you: boolean;
}

const PAY_ROWS: PayRow[] = [
  { name: "You", sub: "error 0 buckets", amount: "141.57", width: 100, you: true },
  { name: "pitchpoet", sub: "error 0 buckets", amount: "96.20", width: 68, you: false },
  { name: "cornerkid", sub: "error 1 bucket", amount: "38.44", width: 27, you: false },
  { name: "golazo", sub: "error 1 bucket", amount: "31.02", width: 22, you: false },
];

export function SettlementPanel() {
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [rejected, setRejected] = useState(false);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
        gap: 24,
        borderTop: `1px solid ${C.line}`,
        paddingTop: 18,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: C.muted }}>
            PAYOUT SPLIT
          </span>
          <span style={{ ...num, fontSize: 11.5, color: C.muted }}>match pot 12,480 USDT</span>
        </div>

        {PAY_ROWS.map((r) => (
          <div key={r.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: r.you ? C.ink : C.ink2 }}>{r.name}</span>
              <span style={{ ...num, fontSize: 10, color: C.faint }}>{r.sub}</span>
              <div style={{ flex: 1 }} />
              <span style={{ ...num, fontSize: 13, fontWeight: 700, color: r.you ? C.ink : C.ink2 }}>
                {r.amount}
              </span>
            </div>
            <div style={{ height: 4, background: C.line2, borderRadius: 2, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${r.width}%`,
                  background: r.you ? C.ink : C.faint,
                  borderRadius: 2,
                  transition: "width 1s cubic-bezier(.2,.8,.3,1)",
                }}
              />
            </div>
          </div>
        ))}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: `1px solid ${C.line}`,
            paddingTop: 11,
            fontSize: 13,
          }}
        >
          <span style={{ color: C.muted }}>
            You staked <b style={{ ...num, color: C.ink }}>50.00 USDT</b>
          </span>
          <span style={{ ...num, fontWeight: 800 }}>returned 141.57 USDT</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: C.muted }}>
            SETTLEMENT PROOF
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: C.ink,
            }}
          >
            <CheckIcon size={14} color={C.ink} />
            VERIFIED ON SOLANA
          </span>
        </div>

        <pre
          className="v2-scroll"
          style={{
            margin: 0,
            background: C.ink,
            color: "#c8cdd6",
            borderRadius: 8,
            padding: "13px 15px",
            fontSize: 10.5,
            lineHeight: 1.6,
            fontFamily: "var(--v2-mono), SFMono-Regular, monospace",
            overflowX: "auto",
          }}
        >
          {PROOF_JSON}
        </pre>

        <div style={{ ...num, display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, color: C.ink2 }}>
          <span>root 0xb7f04c19…21d9 · slot 287,441,022</span>
          <a href="https://explorer.solana.com/?cluster=devnet" target="_blank" rel="noopener noreferrer">
            View transaction on Solana Explorer ↗
          </a>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: C.ink,
            color: C.white,
            borderRadius: 8,
            padding: "12px 15px",
          }}
        >
          <LockIcon size={18} color={C.white} />
          <span style={{ fontSize: 12, lineHeight: 1.55 }}>
            <b>No admin key.</b> No oracle committee, no human. Nothing but a valid Merkle proof can move this pot.
          </span>
        </div>

        <button
          onClick={() => setVerifyOpen((v) => !v)}
          style={{
            border: `1px solid ${C.line}`,
            background: C.white,
            borderRadius: 6,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 700,
            color: C.ink,
            textAlign: "left",
          }}
        >
          {verifyOpen ? "Hide the proof walk" : "Verify it yourself →"}
        </button>

        {verifyOpen && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {LEVELS.map((lv, i) => {
              const isRoot = lv.lab === "ROOT";
              return (
                <div key={lv.lab} style={{ display: "flex", flexDirection: "column" }}>
                  {i > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0 2px 26px" }}>
                      <span style={{ width: 1, height: 14, background: C.hair }} />
                      <span style={{ ...num, fontSize: 9.5, color: C.faint }}>↑ sha256(left ‖ right)</span>
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      border: `1px solid ${isRoot ? C.ink : C.line}`,
                      background: isRoot ? C.surface : C.white,
                      borderRadius: 6,
                      padding: "7px 11px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        letterSpacing: "0.1em",
                        color: isRoot ? C.ink : C.muted,
                        minWidth: 34,
                      }}
                    >
                      {lv.lab}
                    </span>
                    <span style={{ ...num, fontSize: 11, color: C.ink }}>{lv.hash}</span>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 10, color: C.muted }}>{lv.note}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button
          onClick={() => setRejected(true)}
          style={{
            border: `1px dashed ${C.live}`,
            background: C.white,
            borderRadius: 6,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 700,
            color: C.live,
          }}
        >
          Simulate a forged submission
        </button>

        {rejected && (
          <div style={{ position: "absolute", inset: -8, borderRadius: 10, overflow: "hidden", zIndex: 10 }}>
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: "51%",
                background: "#151210",
                animation: "v2-vault-l 0.45s cubic-bezier(.2,.9,.2,1) both",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                right: 0,
                width: "51%",
                background: "#151210",
                animation: "v2-vault-r 0.45s cubic-bezier(.2,.9,.2,1) both",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 9,
                padding: 20,
                textAlign: "center",
                animation: "v2-pop-in 0.35s 0.4s both",
              }}
            >
              <DeniedIcon size={30} color="#e07a72" />
              <span style={{ fontSize: 15, fontWeight: 900, letterSpacing: "0.14em", color: "#e8b4b0" }}>
                TRANSACTION REJECTED
              </span>
              <span
                style={{
                  ...num,
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: "#e07a72",
                  background: "rgba(224,122,114,0.1)",
                  border: "1px solid rgba(224,122,114,0.35)",
                  borderRadius: 5,
                  padding: "3px 10px",
                }}
              >
                InvalidStatProof (0x1771)
              </span>
              <span style={{ ...num, fontSize: 10.5, color: "#a8a29e", lineHeight: 1.7 }}>
                submitted leaf: goals.P1 = 5
                <br />
                computed root 0x31aa…e07f ≠ on-chain root 0xb7f0…21d9
              </span>
              <span style={{ fontSize: 12, color: "#e7e5e4" }}>The chain checked the math. The math said no.</span>
              <button
                onClick={() => setRejected(false)}
                style={{
                  marginTop: 4,
                  border: "1px solid #57534e",
                  background: "none",
                  color: "#d6d3d1",
                  borderRadius: 6,
                  padding: "6px 16px",
                  fontSize: 11.5,
                  fontWeight: 700,
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
