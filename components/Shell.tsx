"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { C, num } from "@/lib/tokens";
import { toUsdc, userAta } from "@/lib/chain";

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

/**
 * Real Phantom connection. The wallet-adapter's own button is deliberately not
 * used: it ships its own CSS-variable theme that fights the shell's flat ink
 * palette. This drives the same modal and hooks, just styled like the rest.
 */
function WalletButton() {
  const { connection } = useConnection();
  const { publicKey, connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setBalance(null);
      return;
    }
    let live = true;
    // A wallet with no ATA yet has never held the token — that is 0, not an error.
    const read = () =>
      connection
        .getTokenAccountBalance(userAta(publicKey))
        .then((b) => live && setBalance(toUsdc(Number(b.value.amount))))
        .catch(() => live && setBalance(0));
    read();
    // Cheap poll: the balance changes when the user stakes or claims, and those
    // happen in this tab, so a slow interval is enough to keep the header honest.
    const t = setInterval(read, 8000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [publicKey, connection]);

  if (!connected || !publicKey) {
    return (
      <button
        onClick={() => setVisible(true)}
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
    );
  }

  const addr = publicKey.toBase58();
  return (
    <button
      onClick={() => disconnect()}
      title="Click to disconnect"
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
      <span style={{ ...num, color: C.ink, fontWeight: 600 }}>
        {addr.slice(0, 4)}…{addr.slice(-4)}
      </span>
      <span style={{ ...num, color: C.muted }}>
        {balance === null ? "—" : `${balance.toFixed(2)} USDC`}
      </span>
    </button>
  );
}

function TopBar() {
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
      <Link href="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/betman.png" alt="Betman" height={26} style={{ height: 26, width: "auto", display: "block" }} />
      </Link>
      <div style={{ flex: 1 }} />
      <WalletButton />
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
            width: "90vw",
            height: "90vh",
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
