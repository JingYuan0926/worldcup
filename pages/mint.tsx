"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { Layout } from "@/components/Layout";
import { C, num } from "@/lib/tokens";
import { USDC_MINT, explorerAddress, explorerTx } from "@/lib/chain";

type Result =
  | { kind: "ok"; signature: string; balance: string }
  | { kind: "err"; error: string };

/**
 * Test-USDC faucet.
 *
 * The mint authority's key lives on the server (pages/api/mint.ts) and never
 * reaches the browser — this page just posts an address to it.
 */
export default function MintPage() {
  const { publicKey } = useWallet();
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState(500);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // Prefill with the connected wallet, but keep it editable: funding a second
  // wallet to demo a crowded pool is the common case.
  useEffect(() => {
    if (publicKey && !address) setAddress(publicKey.toBase58());
  }, [publicKey, address]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: address.trim(), amount }),
      });
      const data = await res.json();
      setResult(
        data.ok
          ? { kind: "ok", signature: data.signature, balance: data.balance }
          : { kind: "err", error: data.error },
      );
    } catch (err) {
      setResult({ kind: "err", error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout>
      <div style={{ padding: "26px 26px 40px", maxWidth: 640, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/match/18222446" style={{ color: C.muted, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
            ← Match
          </Link>
        </div>

        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
            Get test USDC
          </h1>
          <p style={{ fontSize: 13, color: C.ink2, lineHeight: 1.6, marginTop: 8 }}>
            Stakes are escrowed in a 6-decimal SPL token we mint for the demo. It is{" "}
            <b>not real USDC</b> — Circle&apos;s devnet USDC exists, but its mint authority is
            Circle&apos;s, so a demo could only ever hold faucet dust. This behaves identically
            on-chain and we can hand out as much as the demo needs.
          </p>
        </div>

        <form
          onSubmit={submit}
          style={{
            border: `1px solid ${C.line}`,
            borderRadius: 10,
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em" }}>
              WALLET ADDRESS
            </span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Paste a Solana address, or connect a wallet"
              spellCheck={false}
              style={{
                ...num,
                border: `1px solid ${C.line}`,
                borderRadius: 6,
                padding: "10px 12px",
                fontSize: 13,
              }}
            />
            {publicKey && address !== publicKey.toBase58() && (
              <button
                type="button"
                onClick={() => setAddress(publicKey.toBase58())}
                style={{
                  alignSelf: "flex-start",
                  border: "none",
                  background: "none",
                  color: C.muted,
                  fontSize: 11,
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                  padding: 0,
                }}
              >
                use connected wallet
              </button>
            )}
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", flex: 1 }}>
              AMOUNT
            </span>
            <input
              type="number"
              min={1}
              max={1000}
              value={amount}
              onChange={(e) => setAmount(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
              style={{
                ...num,
                width: 100,
                border: `1px solid ${C.line}`,
                borderRadius: 6,
                padding: "9px 10px",
                fontSize: 14,
                fontWeight: 700,
                textAlign: "right",
              }}
            />
            <span style={{ fontSize: 12, color: C.muted }}>USDC</span>
          </label>

          <button
            type="submit"
            disabled={busy || !address.trim()}
            style={{
              border: "none",
              borderRadius: 8,
              padding: "12px 16px",
              fontSize: 13.5,
              fontWeight: 700,
              background: busy || !address.trim() ? C.line2 : C.ink,
              color: busy || !address.trim() ? C.faint : C.white,
              cursor: busy || !address.trim() ? "default" : "pointer",
            }}
          >
            {busy ? "Minting…" : `Mint ${amount} test USDC`}
          </button>

          {result?.kind === "ok" && (
            <div
              style={{
                border: `1px solid ${C.line}`,
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 12,
                color: C.ink2,
                lineHeight: 1.6,
              }}
            >
              ✓ Minted. Balance now <b style={num}>{result.balance} USDC</b> ·{" "}
              <a href={explorerTx(result.signature)} target="_blank" rel="noreferrer" style={{ color: C.ink }}>
                view tx ↗
              </a>
              <br />
              <span style={{ color: C.muted }}>
                Phantom shows it under this mint — add it manually if it doesn&apos;t appear.
              </span>
            </div>
          )}

          {result?.kind === "err" && (
            <div
              style={{
                border: `1px solid ${C.live}`,
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 12,
                color: C.live,
                lineHeight: 1.6,
              }}
            >
              {result.error}
            </div>
          )}
        </form>

        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.7 }}>
          Mint{" "}
          <a href={explorerAddress(USDC_MINT.toBase58())} target="_blank" rel="noreferrer" style={{ ...num, color: C.ink2 }}>
            {USDC_MINT.toBase58()}
          </a>
          <br />
          Devnet only. The faucet is open by design; the key behind it is a devnet key.
        </div>
      </div>
    </Layout>
  );
}
