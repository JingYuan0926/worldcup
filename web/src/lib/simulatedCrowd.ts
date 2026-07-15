import type { LiveEvent } from "./types";

/**
 * Deterministic, synthetic crowd forecasts used by the post-match demo graph.
 *
 * IMPORTANT: this is presentation-only demo data. It is not TxLINE data, real
 * entries, odds, or a settlement input. A value at index `n` is the number of
 * simulated predictions targeting the exact match second `n`.
 */

export const SIMULATED_CROWD_MATCH_SECONDS = 120 * 60;
export const SIMULATED_CROWD_SECOND_COUNT = SIMULATED_CROWD_MATCH_SECONDS + 1;

/**
 * Minutes 0..119 each aggregate 60 seconds. Index 120 contains only 120:00,
 * preserving the inclusive final timeline boundary instead of dropping it.
 */
export const SIMULATED_CROWD_MINUTE_COUNT = 121;

export type SimulatedCrowdEventKind = LiveEvent["kind"];
export type SimulatedCrowdTeam = LiveEvent["team"];
export type SimulatedCrowdSecondCounts = readonly number[];
export type SimulatedCrowdMinuteCounts = readonly number[];

export interface SimulatedCrowdSecondPeak {
  second: number;
  count: number;
}

export interface SimulatedCrowdMinutePeak {
  minute: number;
  count: number;
}

interface InterestCenter {
  second: number;
  spread: number;
  weight: number;
}

interface CrowdProfile {
  /** Probability of a non-zero exact second before the interest curve. */
  density: number;
  /** Upper shape bound for ordinary, non-peak counts. */
  countScale: number;
  centers: readonly InterestCenter[];
  /** A guaranteed visible peak, useful for stable demo callouts. */
  peakSecond: number;
  peakCount: number;
}

type TeamProfiles = Readonly<Record<SimulatedCrowdTeam, CrowdProfile>>;
type TeamSecondDistributions = Readonly<
  Record<SimulatedCrowdTeam, SimulatedCrowdSecondCounts>
>;
type TeamMinuteDistributions = Readonly<
  Record<SimulatedCrowdTeam, SimulatedCrowdMinuteCounts>
>;

const EVENT_KINDS: readonly SimulatedCrowdEventKind[] = [
  "goal",
  "corner",
  "yellow",
  "red",
];
const TEAMS: readonly SimulatedCrowdTeam[] = ["home", "away"];

const PROFILES: Readonly<Record<SimulatedCrowdEventKind, TeamProfiles>> = {
  goal: {
    home: {
      density: 0.044,
      countScale: 8,
      centers: [
        { second: 1_420, spread: 560, weight: 1.3 },
        { second: 3_980, spread: 720, weight: 1.05 },
        { second: 5_620, spread: 500, weight: 0.72 },
      ],
      peakSecond: 1_627,
      peakCount: 15,
    },
    away: {
      density: 0.039,
      countScale: 7,
      centers: [
        { second: 1_850, spread: 650, weight: 0.78 },
        { second: 4_060, spread: 640, weight: 1.35 },
        { second: 5_510, spread: 560, weight: 0.86 },
      ],
      peakSecond: 4_012,
      peakCount: 14,
    },
  },
  corner: {
    home: {
      density: 0.052,
      countScale: 7,
      centers: [
        { second: 780, spread: 430, weight: 1.18 },
        { second: 3_180, spread: 780, weight: 0.9 },
        { second: 5_050, spread: 680, weight: 1.08 },
      ],
      peakSecond: 745,
      peakCount: 13,
    },
    away: {
      density: 0.049,
      countScale: 7,
      centers: [
        { second: 1_530, spread: 620, weight: 0.83 },
        { second: 3_070, spread: 650, weight: 1.28 },
        { second: 5_880, spread: 530, weight: 0.94 },
      ],
      peakSecond: 3_064,
      peakCount: 12,
    },
  },
  yellow: {
    home: {
      density: 0.032,
      countScale: 7,
      centers: [
        { second: 2_620, spread: 700, weight: 1.3 },
        { second: 4_760, spread: 720, weight: 1.02 },
        { second: 6_280, spread: 420, weight: 0.8 },
      ],
      peakSecond: 2_729,
      peakCount: 12,
    },
    away: {
      density: 0.036,
      countScale: 8,
      centers: [
        { second: 2_180, spread: 720, weight: 0.86 },
        { second: 4_470, spread: 690, weight: 1.4 },
        { second: 5_980, spread: 500, weight: 1.0 },
      ],
      peakSecond: 4_486,
      peakCount: 15,
    },
  },
  red: {
    home: {
      density: 0.009,
      countScale: 5,
      centers: [
        { second: 3_720, spread: 850, weight: 0.65 },
        { second: 5_180, spread: 620, weight: 1.38 },
      ],
      peakSecond: 5_120,
      peakCount: 9,
    },
    away: {
      density: 0.011,
      countScale: 5,
      centers: [
        { second: 3_100, spread: 900, weight: 0.68 },
        { second: 5_760, spread: 670, weight: 1.45 },
      ],
      peakSecond: 5_804,
      peakCount: 10,
    },
  },
};

const PROFILE_SEEDS: Readonly<
  Record<SimulatedCrowdEventKind, Readonly<Record<SimulatedCrowdTeam, number>>>
> = {
  goal: { home: 0x237d_91a3, away: 0x9b13_76e5 },
  corner: { home: 0x45ae_20d1, away: 0xe184_39b7 },
  yellow: { home: 0x70c2_5f43, away: 0x1ad9_842f },
  red: { home: 0xc831_0ea9, away: 0x5f24_b6d3 },
};

/** A stable pseudo-random value in [0, 1), keyed independently per second. */
function randomAt(seed: number, second: number, salt: number): number {
  let value = (seed ^ Math.imul(second + 1, 0x45d9_f3b) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9_f3b) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9_f3b) >>> 0;
  value = (value ^ (value >>> 16)) >>> 0;
  return value / 0x1_0000_0000;
}

function gaussian(second: number, center: InterestCenter): number {
  const distance = (second - center.second) / center.spread;
  return center.weight * Math.exp(-0.5 * distance * distance);
}

function makeSecondCounts(
  eventKind: SimulatedCrowdEventKind,
  team: SimulatedCrowdTeam,
): SimulatedCrowdSecondCounts {
  const profile = PROFILES[eventKind][team];
  const seed = PROFILE_SEEDS[eventKind][team];
  const values = new Array<number>(SIMULATED_CROWD_SECOND_COUNT).fill(0);

  for (let second = 0; second <= SIMULATED_CROWD_MATCH_SECONDS; second += 1) {
    const normalizedTime = second / SIMULATED_CROWD_MATCH_SECONDS;
    const lateMatchInterest = 0.28 + normalizedTime * 0.38;
    const centerInterest = profile.centers.reduce(
      (total, center) => total + gaussian(second, center),
      0,
    );
    const interest = lateMatchInterest + centerInterest;
    const nonZeroChance = Math.min(0.22, profile.density * interest);

    if (randomAt(seed, second, 0x6d2b_79f5) >= nonZeroChance) {
      continue;
    }

    const localCeiling = Math.max(
      2,
      Math.min(profile.peakCount - 1, Math.round(1 + profile.countScale * interest)),
    );
    // Squaring the draw keeps most populated seconds at one or two entries,
    // with occasional taller bars instead of a dense artificial-looking wall.
    const countDraw = randomAt(seed, second, 0xa511_e9b3);
    values[second] = 1 + Math.floor(countDraw * countDraw * localCeiling);
  }

  values[profile.peakSecond] = profile.peakCount;
  return Object.freeze(values);
}

function aggregateMinutes(seconds: SimulatedCrowdSecondCounts): SimulatedCrowdMinuteCounts {
  const minutes = new Array<number>(SIMULATED_CROWD_MINUTE_COUNT).fill(0);
  seconds.forEach((count, second) => {
    minutes[Math.floor(second / 60)] += count;
  });
  return Object.freeze(minutes);
}

function makeSecondDistributions(): Readonly<
  Record<SimulatedCrowdEventKind, TeamSecondDistributions>
> {
  return Object.freeze(
    Object.fromEntries(
      EVENT_KINDS.map((eventKind) => [
        eventKind,
        Object.freeze(
          Object.fromEntries(
            TEAMS.map((team) => [team, makeSecondCounts(eventKind, team)]),
          ) as Record<SimulatedCrowdTeam, SimulatedCrowdSecondCounts>,
        ),
      ]),
    ) as Record<SimulatedCrowdEventKind, TeamSecondDistributions>,
  );
}

function makeMinuteDistributions(
  seconds: Readonly<Record<SimulatedCrowdEventKind, TeamSecondDistributions>>,
): Readonly<Record<SimulatedCrowdEventKind, TeamMinuteDistributions>> {
  return Object.freeze(
    Object.fromEntries(
      EVENT_KINDS.map((eventKind) => [
        eventKind,
        Object.freeze({
          home: aggregateMinutes(seconds[eventKind].home),
          away: aggregateMinutes(seconds[eventKind].away),
        }),
      ]),
    ) as Record<SimulatedCrowdEventKind, TeamMinuteDistributions>,
  );
}

/** Stable sparse exact-second demo counts, keyed by event kind and team. */
export const SIMULATED_DEMO_CROWD_SECOND_COUNTS = makeSecondDistributions();

/** Stable minute aggregates derived from the exact-second source of truth. */
export const SIMULATED_DEMO_CROWD_MINUTE_COUNTS = makeMinuteDistributions(
  SIMULATED_DEMO_CROWD_SECOND_COUNTS,
);

export function getSimulatedCrowdSecondCounts(
  eventKind: SimulatedCrowdEventKind,
  team: SimulatedCrowdTeam,
): SimulatedCrowdSecondCounts {
  return SIMULATED_DEMO_CROWD_SECOND_COUNTS[eventKind][team];
}

export function getSimulatedCrowdMinuteCounts(
  eventKind: SimulatedCrowdEventKind,
  team: SimulatedCrowdTeam,
): SimulatedCrowdMinuteCounts {
  return SIMULATED_DEMO_CROWD_MINUTE_COUNTS[eventKind][team];
}

function maxValue(values: readonly number[]): number {
  return values.reduce((maximum, count) => Math.max(maximum, count), 0);
}

function peakIndex(values: readonly number[]): number {
  let peak = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[peak]) peak = index;
  }
  return peak;
}

/** Shared exact-second scale across both teams, or a team-specific max. */
export function getSimulatedCrowdSecondMaxCount(
  eventKind: SimulatedCrowdEventKind,
  team?: SimulatedCrowdTeam,
): number {
  if (team) return maxValue(getSimulatedCrowdSecondCounts(eventKind, team));
  return Math.max(
    maxValue(getSimulatedCrowdSecondCounts(eventKind, "home")),
    maxValue(getSimulatedCrowdSecondCounts(eventKind, "away")),
  );
}

/** Shared minute scale across both teams, or a team-specific max. */
export function getSimulatedCrowdMinuteMaxCount(
  eventKind: SimulatedCrowdEventKind,
  team?: SimulatedCrowdTeam,
): number {
  if (team) return maxValue(getSimulatedCrowdMinuteCounts(eventKind, team));
  return Math.max(
    maxValue(getSimulatedCrowdMinuteCounts(eventKind, "home")),
    maxValue(getSimulatedCrowdMinuteCounts(eventKind, "away")),
  );
}

export function getSimulatedCrowdTotalCount(
  eventKind: SimulatedCrowdEventKind,
  team: SimulatedCrowdTeam,
): number {
  return getSimulatedCrowdSecondCounts(eventKind, team).reduce(
    (total, count) => total + count,
    0,
  );
}

export function getSimulatedCrowdPeakSecond(
  eventKind: SimulatedCrowdEventKind,
  team: SimulatedCrowdTeam,
): SimulatedCrowdSecondPeak {
  const values = getSimulatedCrowdSecondCounts(eventKind, team);
  const second = peakIndex(values);
  return { second, count: values[second] };
}

export function getSimulatedCrowdPeakMinute(
  eventKind: SimulatedCrowdEventKind,
  team: SimulatedCrowdTeam,
): SimulatedCrowdMinutePeak {
  const values = getSimulatedCrowdMinuteCounts(eventKind, team);
  const minute = peakIndex(values);
  return { minute, count: values[minute] };
}

/** Read one exact second without making callers index an array directly. */
export function getSimulatedCrowdCountAtSecond(
  eventKind: SimulatedCrowdEventKind,
  team: SimulatedCrowdTeam,
  second: number,
): number {
  if (!Number.isInteger(second) || second < 0 || second > SIMULATED_CROWD_MATCH_SECONDS) {
    throw new RangeError(
      `Simulated crowd second must be between 0 and ${SIMULATED_CROWD_MATCH_SECONDS}; received ${second}.`,
    );
  }
  return getSimulatedCrowdSecondCounts(eventKind, team)[second];
}
