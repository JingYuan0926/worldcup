"use client";

import { useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { RPC_URL } from "@/lib/chain";

/**
 * Phantom is not listed explicitly: it registers itself through the Wallet
 * Standard, so an empty adapter list still discovers it (and any other installed
 * standard wallet). Naming it here would double it up in the modal.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => RPC_URL, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
