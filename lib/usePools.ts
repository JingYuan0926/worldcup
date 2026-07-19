"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { fetchPools, getProgram, type OnChainPool } from "@/lib/chain";
import { ALL_POOL_INDEXES } from "@/lib/pools";

export interface PoolsState {
  pools: Record<number, OnChainPool | null>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Live view of the six goal pools.
 *
 * Reads deliberately do not require a wallet — the crowd histogram, the pot sizes
 * and the settled outcomes are public, and the page must render fully before
 * anyone connects.
 */
export function usePools(fixtureId: number, pollMs = 10_000): PoolsState {
  const wallet = useAnchorWallet();
  const [pools, setPools] = useState<Record<number, OnChainPool | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Goal pools AND the flash pool — anything the page can render.
  const indexes = useMemo(() => ALL_POOL_INDEXES, []);
  const program = useMemo(() => getProgram(wallet ?? null), [wallet]);

  const refresh = useCallback(async () => {
    // fixtureId 0 = the demo state has not loaded yet; a fetch now would derive
    // PDAs for a namespace that does not exist and render six empty pools.
    if (!fixtureId) return;
    try {
      const list = await fetchPools(program, indexes, fixtureId);
      const next: Record<number, OnChainPool | null> = {};
      indexes.forEach((idx, i) => {
        next[idx] = list[i] ?? null;
      });
      setPools(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [program, indexes, fixtureId]);

  /**
   * Drop everything the moment the room changes.
   *
   * A reset takes ~100s, and for all of it this hook would otherwise keep serving
   * the OLD room's pools — a fresh object every poll, which re-fires anything
   * watching `pools`. That is what resurrected the cleared markers: the board was
   * emptied, then immediately re-hydrated from entries in a room being replaced.
   * Empty is the honest state while a room is being built.
   */
  useEffect(() => {
    setPools({});
    setLoading(true);
  }, [fixtureId]);

  useEffect(() => {
    let live = true;
    const tick = () => {
      if (live) void refresh();
    };
    tick();
    const t = setInterval(tick, pollMs);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [refresh, pollMs]);

  return { pools, loading, error, refresh };
}
