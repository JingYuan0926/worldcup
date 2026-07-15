"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { WalletReadyState, type WalletError } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { clusterApiUrl, Connection, type PublicKey } from "@solana/web3.js";

interface SolanaWalletContextValue {
  adapter: PhantomWalletAdapter;
  connection: Connection;
  publicKey: PublicKey | null;
  connected: boolean;
  connecting: boolean;
  readyState: WalletReadyState;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const SolanaWalletContext = createContext<SolanaWalletContextValue | null>(null);

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The wallet connection did not complete.";
}

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const adapter = useMemo(() => new PhantomWalletAdapter(), []);
  const connection = useMemo(
    () =>
      new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl("devnet"),
        "confirmed",
      ),
    [],
  );
  // Fixed SSR-safe initial values avoid hydration differences when Phantom is installed.
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [readyState, setReadyState] = useState<WalletReadyState>(WalletReadyState.Unsupported);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onConnect = (key: PublicKey) => {
      setPublicKey(key);
      setConnecting(false);
      setError(null);
    };
    const onDisconnect = () => {
      setPublicKey(null);
      setConnecting(false);
    };
    const onError = (walletError: WalletError) => {
      setConnecting(false);
      setError(errorMessage(walletError));
    };
    const onReadyStateChange = (next: WalletReadyState) => setReadyState(next);

    adapter.on("connect", onConnect);
    adapter.on("disconnect", onDisconnect);
    adapter.on("error", onError);
    adapter.on("readyStateChange", onReadyStateChange);
    setReadyState(adapter.readyState);
    setPublicKey(adapter.publicKey);

    return () => {
      adapter.off("connect", onConnect);
      adapter.off("disconnect", onDisconnect);
      adapter.off("error", onError);
      adapter.off("readyStateChange", onReadyStateChange);
    };
  }, [adapter]);

  const connect = useCallback(async () => {
    if (adapter.connected || connecting) return;
    setConnecting(true);
    setError(null);
    try {
      await adapter.connect();
      setPublicKey(adapter.publicKey);
    } catch (walletError) {
      setConnecting(false);
      if (adapter.readyState === WalletReadyState.NotDetected) {
        window.open(adapter.url, "_blank", "noopener,noreferrer");
        setError("Phantom is not installed. Its setup page opened in a new tab.");
        return;
      }
      setError(errorMessage(walletError));
    }
  }, [adapter, connecting]);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await adapter.disconnect();
      setPublicKey(null);
    } catch (walletError) {
      setError(errorMessage(walletError));
    }
  }, [adapter]);

  const value = useMemo<SolanaWalletContextValue>(
    () => ({
      adapter,
      connection,
      publicKey,
      connected: Boolean(publicKey),
      connecting,
      readyState,
      error,
      connect,
      disconnect,
    }),
    [adapter, connect, connecting, connection, disconnect, error, publicKey, readyState],
  );

  return <SolanaWalletContext.Provider value={value}>{children}</SolanaWalletContext.Provider>;
}

export function useSolanaWallet(): SolanaWalletContextValue {
  const value = useContext(SolanaWalletContext);
  if (!value) throw new Error("useSolanaWallet must be used inside SolanaWalletProvider");
  return value;
}
