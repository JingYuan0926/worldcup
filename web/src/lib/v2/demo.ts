import type { EventKind } from "@/components/v2/Icons";

/**
 * Deterministic demo dataset for the v2 shell. Every value is seeded so SSR and
 * the client agree, and so a replayed match reproduces exactly — a random drop
 * schedule that differed between takes would make the demo unshootable.
 */

export const MATCH_SECONDS = 120 * 60;
/** On-chain roots are posted per 5-minute batch (README §5.1). */
export const BUCKET_SECONDS = 5 * 60;

export type Side = "home" | "away";

export interface Team {
  code: string;
  name: string;
  flag: string;
  color: string;
}

export const HOME: Team = {
  code: "ARG",
  name: "Argentina",
  flag: "https://flagcdn.com/w80/ar.png",
  color: "#2458c5",
};
export const AWAY: Team = {
  code: "SUI",
  name: "Switzerland",
  flag: "https://flagcdn.com/w80/ch.png",
  color: "#cf2e3a",
};

export function team(side: Side): Team {
  return side === "home" ? HOME : AWAY;
}

export interface MatchEvent {
  second: number;
  kind: EventKind;
  side: Side;
  player: string;
}

/**
 * Argentina 3–1 Switzerland (AET). The regulation events match the FIFA
 * timeline; the two Argentina goals in extra time carry the scoreline to 3–1.
 */
export const MATCH_EVENTS: MatchEvent[] = [
  { second: 10 * 60 + 22, kind: "goal", side: "home", player: "Alexis MAC ALLISTER" },
  { second: 44 * 60 + 5, kind: "yellow", side: "away", player: "Breel EMBOLO" },
  { second: 67 * 60 + 41, kind: "goal", side: "away", player: "Dan NDOYE" },
  { second: 72 * 60 + 18, kind: "red", side: "away", player: "Breel EMBOLO" },
  { second: 78 * 60 + 3, kind: "sub", side: "home", player: "Nico GONZALEZ" },
  { second: 98 * 60 + 47, kind: "goal", side: "home", player: "Lautaro MARTINEZ" },
  { second: 113 * 60 + 12, kind: "goal", side: "home", player: "Julian ALVAREZ" },
];

export interface PhaseMark {
  second: number;
  label: string;
}

export const PHASE_MARKS: PhaseMark[] = [
  { second: 0, label: "KICK OFF" },
  { second: 45 * 60, label: "HALF TIME" },
  { second: 90 * 60, label: "FULL TIME" },
  { second: 105 * 60, label: "EXTRA TIME" },
];

export const FIXTURE = {
  fixtureId: 18209181,
  competition: "FIFA WORLD CUP 2026 · QUARTER-FINAL",
  venue: "Kansas City Stadium",
  attendance: "69,045",
  referee: "João Pedro Silva Pinheiro",
};

/* ---------------------------------------------------------------- time ---- */

export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function clockLabel(second: number): string {
  return `${String(Math.floor(second / 60)).padStart(2, "0")}'`;
}

/** The 5-minute settlement bucket a given second falls in. */
export function bucketOf(second: number): number {
  return Math.floor(second / BUCKET_SECONDS);
}

export interface BucketWindow {
  index: number;
  startSecond: number;
  endSecond: number;
  label: string;
  /** True when the lock truncates the window — boundaries align to kickoff, not to the lock. */
  short: boolean;
}

/**
 * The window a call settles on. `notBefore` is the lock: buckets are aligned to
 * kickoff, so the first one after a mid-match lock is usually a stub, and the UI
 * must show the real boundaries rather than a rounded fiction.
 */
export function windowFor(second: number, notBefore = 0): BucketWindow {
  const index = bucketOf(second);
  const rawStart = index * BUCKET_SECONDS;
  const startSecond = Math.max(rawStart, notBefore);
  const endSecond = rawStart + BUCKET_SECONDS - 1;
  return {
    index,
    startSecond,
    endSecond,
    label: `${mmss(startSecond)}–${mmss(endSecond)}`,
    short: startSecond > rawStart,
  };
}

/* -------------------------------------------------------------- crowd ---- */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sparse per-slot crowd density behind a lane — how many other people called
 * this moment. Read as texture, not as a histogram: it exists to tell you
 * whether your call is crowded or lonely.
 */
export function crowdBars(seed: number, slots = 240): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < slots; i++) {
    const t = i / slots;
    // Fans cluster on round minutes and late in each half.
    const roundBias = i % 10 === 0 ? 0.35 : 0;
    const shape = 0.25 + 0.45 * Math.sin(Math.PI * t) + roundBias;
    const v = rng() * shape;
    out.push(v < 0.08 ? 0 : Math.min(1, v));
  }
  return out;
}

/* -------------------------------------------------------- flash markets ---- */

export const FLASH_ENTRY_SECONDS = 120;
/** Slider range, in minutes measured from the lock. */
export const FLASH_MAX_MINUTES = 15;
/** Sentinel for "they don't score again". */
export const NEVER = -1;

export type FlashState = "open" | "watching" | "void" | "settled";

export interface FlashMarket {
  id: string;
  side: Side;
  /** When the card drops into the rail. */
  dropSecond: number;
  /** Entries close here. The measured window starts at this instant. */
  lockSecond: number;
}

export function flashQuestion(m: FlashMarket): string {
  return `How many minutes until ${team(m.side).name} scores their next goal?`;
}

/**
 * Drops are random but not arbitrary. The guardrails are what make the card
 * feel like it has judgment behind it:
 *   - never inside the last 20 minutes, so the measured window can actually run
 *   - never within 3 minutes of that team's own goal
 *   - a cooldown between drops, so the rail never feels spammy
 */
export const FLASH_MARKETS: FlashMarket[] = [
  { id: "f1", side: "home", dropSecond: 26 * 60, lockSecond: 26 * 60 + FLASH_ENTRY_SECONDS },
  { id: "f2", side: "away", dropSecond: 52 * 60, lockSecond: 52 * 60 + FLASH_ENTRY_SECONDS },
  { id: "f3", side: "home", dropSecond: 84 * 60, lockSecond: 84 * 60 + FLASH_ENTRY_SECONDS },
];

/** That team's next goal strictly after `second`, if any. */
export function nextGoalAfter(second: number, side: Side): MatchEvent | undefined {
  return MATCH_EVENTS.find((e) => e.kind === "goal" && e.side === side && e.second > second);
}

/**
 * A market voids when the goal lands during the 2-minute entry window: the
 * question stopped making sense before it ever locked, so everyone is refunded.
 * This fires in real matches, so it is a first-class state rather than an edge.
 */
export function voidsAt(m: FlashMarket): number | undefined {
  const g = MATCH_EVENTS.find(
    (e) =>
      e.kind === "goal" &&
      e.side === m.side &&
      e.second > m.dropSecond &&
      e.second <= m.lockSecond,
  );
  return g?.second;
}

export function flashStateAt(m: FlashMarket, now: number): FlashState | null {
  if (now < m.dropSecond) return null;
  const voided = voidsAt(m);
  if (voided !== undefined) return now >= voided ? "void" : "open";
  if (now < m.lockSecond) return "open";
  const goal = nextGoalAfter(m.lockSecond, m.side);
  // A NEVER outcome only resolves at full time, not mid-match.
  const resolveAt = goal ? goal.second : MATCH_SECONDS;
  return now >= resolveAt ? "settled" : "watching";
}

/** The true answer in minutes from the lock, or NEVER. */
export function flashActual(m: FlashMarket): number {
  const goal = nextGoalAfter(m.lockSecond, m.side);
  if (!goal) return NEVER;
  return (goal.second - m.lockSecond) / 60;
}

export function flashActualWindow(m: FlashMarket): BucketWindow | null {
  const goal = nextGoalAfter(m.lockSecond, m.side);
  if (!goal) return null;
  return windowFor(goal.second, m.lockSecond);
}

/** Where a call of `minutes` from the lock actually settles. */
export function callWindow(m: FlashMarket, minutes: number): BucketWindow | null {
  if (minutes === NEVER) return null;
  return windowFor(m.lockSecond + minutes * 60, m.lockSecond);
}

/**
 * Bucket-index error, matching README §5.3: WHEN pools score on buckets, and
 * NEVER sits past the end of the range so a late call is less wrong than an
 * early one when the event never comes.
 */
export function flashError(m: FlashMarket, call: number): number {
  const actualWin = flashActualWindow(m);
  const neverIndex = bucketOf(MATCH_SECONDS) + 2;

  if (call === NEVER) return actualWin === null ? 0 : neverIndex - actualWin.index;
  const callWin = callWindow(m, call);
  if (!callWin) return neverIndex;
  if (actualWin === null) return neverIndex - callWin.index;
  return Math.abs(callWin.index - actualWin.index);
}

/** Seeded pool size so the ticker is reproducible across takes. */
export function flashPool(m: FlashMarket, now: number): { usdt: number; entries: number } {
  const rng = mulberry32(m.dropSecond);
  const base = 180 + Math.floor(rng() * 220);
  const elapsed = Math.max(0, Math.min(now - m.dropSecond, FLASH_ENTRY_SECONDS));
  const growth = elapsed / FLASH_ENTRY_SECONDS;
  const entries = 4 + Math.floor(growth * (9 + Math.floor(rng() * 8)));
  return { usdt: Math.round(base + growth * base * 1.4), entries };
}
