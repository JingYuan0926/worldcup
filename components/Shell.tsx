"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { C, num } from "@/lib/tokens";
import { toUsdc, userAta } from "@/lib/chain";

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
        <span
          style={{
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: C.ink,
            whiteSpace: "nowrap",
          }}
        >
          Exact<span style={{ color: C.muted, fontWeight: 700 }}>Match</span>
        </span>
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
        background: C.white,
        fontFamily: "var(--v2-sans), -apple-system, sans-serif",
        color: C.ink,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <TopBar />
      <div className="v2-scroll" style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {children}
      </div>
    </div>
  );
}
