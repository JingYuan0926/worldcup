import {
  BEYOND_BUCKET,
  BUCKET_MINUTES,
  NEVER_BUCKET,
  REGULATION_BUCKETS,
  type WhenPlacement,
} from "./types";

/** USDT formatting with tabular figures in mind (caller adds the `.num` class). */
export function usdt(n: number, opts: { decimals?: number; sign?: boolean } = {}): string {
  const decimals = opts.decimals ?? (Number.isInteger(n) ? 0 : 2);
  const s = n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${opts.sign && n > 0 ? "+" : ""}${s}`;
}

/** Short wallet display: 4A2f…9kQ2. */
export function shortWallet(w: string): string {
  return w.length <= 10 ? w : `${w.slice(0, 4)}…${w.slice(-4)}`;
}

/** Bucket index → human label. */
export function bucketLabel(bucket: number): string {
  if (bucket === NEVER_BUCKET) return "NEVER";
  if (bucket === BEYOND_BUCKET) return "90'+";
  if (bucket === NEVER_BUCKET - 1) return "INVALID";
  const start = bucket * BUCKET_MINUTES;
  const end = start + BUCKET_MINUTES;
  return `${start}–${end}'`;
}

/** Minute → 5-minute bucket index (clamped to the beyond bucket). */
export function minuteToBucket(minute: number): number {
  if (!Number.isFinite(minute) || minute <= 0) return 0;
  if (minute >= REGULATION_BUCKETS * BUCKET_MINUTES) return BEYOND_BUCKET;
  return Math.floor(minute / BUCKET_MINUTES);
}

/** Exact UI placement → provable/payout bucket. Never pass exact seconds to payout math. */
export function placementToBucket(placement: WhenPlacement): number {
  if (placement.kind === "never") return NEVER_BUCKET;
  return minuteToBucket(Math.max(0, Math.floor(placement.atSecond)) / 60);
}

/** Match elapsed time, including extra time, as MM:SS. */
export function matchTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Countdown parts from a target unix-ms. */
export function countdown(targetMs: number, nowMs: number): { text: string; done: boolean } {
  const diff = targetMs - nowMs;
  if (diff <= 0) return { text: "LIVE", done: true };
  const totalSec = Math.floor(diff / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  if (d > 0) return { text: `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`, done: false };
  return { text: `${pad(h)}:${pad(m)}:${pad(s)}`, done: false };
}

/** Deterministic pseudo-color per lane. */
export const laneColor = {
  home: "#1D5FBF",
  away: "#AD2448",
  match: "#147A46",
} as const;
