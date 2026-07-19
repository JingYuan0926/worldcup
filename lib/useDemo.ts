"use client";

import { useCallback, useEffect, useState } from "react";

export interface DemoState {
  fixtureId: number;
  lockTs: number | null;
  lockSeconds: number;
  fresh: boolean;
}

export interface DemoApi extends DemoState {
  loading: boolean;
  /** True while a reset is rebuilding the room — 20–40s of devnet round-trips. */
  resetting: boolean;
  settling: boolean;
  error: string | null;
  steps: string[];
  reset: () => Promise<void>;
  settle: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * The demo's on-chain namespace, and the two operations that move it.
 *
 * The fixture id is served rather than baked in: a reset mints a NEW fixture at
 * runtime, because a settled pool can never be reopened and a pool PDA can only be
 * created once. Everything that derives a PDA has to read from here.
 */
export function useDemo(): DemoApi {
  const [state, setState] = useState<DemoState>({
    fixtureId: 0,
    lockTs: null,
    lockSeconds: 120,
    fresh: false,
  });
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/demo/state");
      setState(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll, don't fetch-once: a reset mints a new fixture, and a page holding the old
  // id derives PDAs for pools that are locked or gone — which looks exactly like
  // "it won't let me place a call". Cheap enough at 6s; it is one small JSON read.
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 6000);
    return () => clearInterval(t);
  }, [refresh]);

  const reset = useCallback(async () => {
    setResetting(true);
    setError(null);
    setSteps([]);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setSteps(data.steps ?? []);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetting(false);
    }
  }, [refresh]);

  /**
   * Settle, waiting out the lock if the replay beat it there.
   *
   * The program refuses to settle before `lock_ts`, and whether the replay reaches
   * full time before or after that depends on how long the reset took and when the
   * operator hit Live — timing we cannot pin down. So instead of tuning the lock to
   * a guess, this just retries until the chain allows it.
   */
  const settle = useCallback(async () => {
    setSettling(true);
    setError(null);
    try {
      for (let attempt = 0; attempt < 25; attempt++) {
        const res = await fetch("/api/demo/settle", { method: "POST" });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);

        const waiting = (data.skipped ?? []).some((x: string) => /NotYetLocked/.test(x));
        if (!waiting) {
          setSteps(data.settled ?? []);
          return;
        }
        setSteps(["waiting for entries to close…"]);
        await new Promise((r) => setTimeout(r, 3000));
      }
      throw new Error("pools never unlocked");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettling(false);
    }
  }, []);

  return { ...state, loading, resetting, settling, error, steps, reset, settle, refresh };
}
