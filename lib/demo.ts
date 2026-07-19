import type { EventKind } from "@/components/Icons";

/**
 * Deterministic demo dataset for the v2 shell. Every value is seeded so SSR and
 * the client agree, and so a replayed match reproduces exactly — a random drop
 * schedule that differed between takes would make the demo unshootable.
 */

/**
 * 124', not 120'. The TxLINE clock runs through stoppage rather than resetting
 * at each period boundary, and fixture 18222446 ran to 123:48 — the winning goal
 * lands at 120:44. A 120' canvas would drop it off the right edge.
 */
export const MATCH_SECONDS = 124 * 60;
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
  /** Absent for corners — TxLINE attributes players to goals and cards only. */
  player?: string;
}

/**
 * Argentina 3–1 Switzerland (AET) — TxLINE fixture 18222446, derived from the
 * raw capture in `txline-raw/`.
 *
 * Every event is reconciled against the feed's own final `Score.Total`
 * (3–1 goals, 8–2 corners, 3–1 yellows, one red). Derived from `Score`
 * transitions rather than `Action=="goal"` frames: TxLINE repeats a goal action
 * across several Seqs and never un-fires it, so counting actions overcounts and
 * keeps VAR-disallowed goals. Player names come from the `lineups` frame in
 * `historical.raw.json`, matched on `PlayerStats` normativeId.
 *
 * Seconds are the feed's continuous match clock, which runs through stoppage:
 * the winner lands at 120:44, past the nominal 120' — see MATCH_SECONDS.
 */
export const MATCH_EVENTS: MatchEvent[] = [
  { second: 8 * 60 + 21, kind: "corner", side: "home" },
  { second: 8 * 60 + 52, kind: "corner", side: "home" },
  { second: 9 * 60 + 35, kind: "goal", side: "home", player: "Lautaro MARTINEZ" },
  { second: 33 * 60 + 40, kind: "corner", side: "away" },
  { second: 43 * 60 + 30, kind: "yellow", side: "away", player: "Breel EMBOLO" },
  { second: 50 * 60 + 59, kind: "corner", side: "home" },
  { second: 62 * 60 + 49, kind: "corner", side: "away" },
  { second: 66 * 60 + 50, kind: "goal", side: "away", player: "Dan NDOYE" },
  { second: 71 * 60 + 20, kind: "red", side: "away", player: "Breel EMBOLO" },
  { second: 90 * 60 + 24, kind: "corner", side: "home" },
  { second: 90 * 60 + 43, kind: "corner", side: "home" },
  { second: 96 * 60 + 5, kind: "yellow", side: "home", player: "Leandro PAREDES" },
  { second: 97 * 60 + 20, kind: "corner", side: "home" },
  { second: 97 * 60 + 33, kind: "yellow", side: "home", player: "Lautaro MARTINEZ" },
  { second: 105 * 60 + 47, kind: "corner", side: "home" },
  { second: 111 * 60 + 42, kind: "goal", side: "home", player: "Julian ALVAREZ" },
  { second: 113 * 60 + 49, kind: "yellow", side: "home", player: "Thiago ALMADA" },
  { second: 118 * 60 + 48, kind: "corner", side: "home" },
  { second: 120 * 60 + 44, kind: "goal", side: "home", player: "Alexis MAC ALLISTER" },
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
  fixtureId: 18222446,
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

/*
 * Removed with the mock: `crowdBars` (seeded fake histogram — the lanes now read
 * real staked lamports from the pools, see components/Timeline.tsx) and the whole
 * flash-market simulator (`FLASH_MARKETS`, `flashPool`, `flashStateAt`, …), which
 * invented pools, pot sizes and entrant counts from a seeded RNG. In-play flash
 * pools are a real product idea (README §5.1 P1) but they need real pools on-chain;
 * until then there is nothing truthful to render.
 */
