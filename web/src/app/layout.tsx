import type { Metadata } from "next";
import Link from "next/link";
import { SolanaWalletProvider } from "@/components/SolanaWalletProvider";
import { WalletButton } from "@/components/WalletButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "Exact Match — precision pools, settled by proof",
  description:
    "Trustless precision prediction pools for the 2026 World Cup. Closest guess wins, settled on Solana by TxLINE Merkle proofs. No admin key, no oracle, no human.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-ink antialiased">
        <SolanaWalletProvider>
          <header className="sticky top-0 z-30 border-b border-line/80 bg-white/90 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
              <Link href="/" className="group flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-pitch/15 text-pitch shadow-glow">
                  ◎
                </span>
                <span className="text-[15px] font-semibold tracking-tight">
                  Exact<span className="text-pitch">Match</span>
                </span>
              </Link>
              <nav className="ml-2 hidden items-center gap-1 text-sm text-muted sm:flex">
                <Link href="/" className="rounded-md px-3 py-1.5 hover:bg-panel hover:text-ink">
                  Matches
                </Link>
                <Link
                  href="/leaderboard"
                  className="rounded-md px-3 py-1.5 hover:bg-panel hover:text-ink"
                >
                  Leaderboard
                </Link>
                <Link
                  href="/replay"
                  className="rounded-md px-3 py-1.5 hover:bg-panel hover:text-ink"
                >
                  Judges’ replay
                </Link>
              </nav>
              <div className="ml-auto flex items-center gap-3">
                <WalletButton />
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 pt-6 text-xs text-muted/70">
            Devnet tokens only — skill-based precision forecasting, not betting. Settlement is
            trustless: nothing but a valid TxLINE Merkle proof can move the pot.
          </footer>
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
