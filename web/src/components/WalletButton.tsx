"use client";

import { shortWallet } from "@/lib/format";
import { useSolanaWallet } from "./SolanaWalletProvider";

export function WalletButton() {
  const { publicKey, connected, connecting, error, connect, disconnect } = useSolanaWallet();
  const address = publicKey?.toBase58() ?? "";

  return (
    <div className="relative flex items-center gap-1.5">
      {connected ? (
        <>
          <a
            href={`https://explorer.solana.com/address/${address}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="num rounded-lg border border-pitch/30 bg-pitch/5 px-3 py-2 text-xs font-semibold text-pitch transition hover:bg-pitch/10"
            title={`${address} on Solana devnet`}
          >
            {shortWallet(address)}
          </a>
          <button
            type="button"
            onClick={() => void disconnect()}
            className="rounded-lg border border-line bg-white px-2.5 py-2 text-xs font-medium text-muted transition hover:border-away/30 hover:bg-red-50 hover:text-away"
          >
            Disconnect
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void connect()}
          disabled={connecting}
          className="inline-flex items-center rounded-lg bg-pitch px-3.5 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-95 disabled:cursor-wait disabled:opacity-65"
        >
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
      )}
      {error && (
        <span
          role="status"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-lg border border-red-200 bg-white p-2 text-xs leading-relaxed text-red-700 shadow-lg"
        >
          {error}
        </span>
      )}
    </div>
  );
}
