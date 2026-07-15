import type { Fixture } from "./types";

/** A completed TxLINE capture that can be replayed by the web app. */
export interface RecordedFixture extends Fixture {
  result: {
    home: number;
    away: number;
    label: "FT" | "AET";
  };
  recording: {
    complete: true;
    seconds: number;
    unknownOpeningSeconds: 0;
  };
}

/**
 * Real World Cup quarterfinals captured from TxLINE on devnet.
 * Keep this catalog static so every route can render without a live API call;
 * the timeline itself still reads the corresponding one-second recording.
 */
export const RECORDED_FIXTURES: readonly RecordedFixture[] = [
  {
    fixtureId: 18209181,
    startTime: Date.parse("2026-07-09T20:00:00Z"),
    participant1: "France",
    participant2: "Morocco",
    competition: "FIFA World Cup 2026 — Quarterfinal",
    competitionId: 72,
    p1Code: "FRA",
    p2Code: "MAR",
    result: { home: 2, away: 0, label: "FT" },
    recording: { complete: true, seconds: 7_242, unknownOpeningSeconds: 0 },
  },
  {
    fixtureId: 18218149,
    startTime: Date.parse("2026-07-10T19:00:00Z"),
    participant1: "Spain",
    participant2: "Belgium",
    competition: "FIFA World Cup 2026 — Quarterfinal",
    competitionId: 72,
    p1Code: "ESP",
    p2Code: "BEL",
    result: { home: 2, away: 1, label: "FT" },
    recording: { complete: true, seconds: 7_161, unknownOpeningSeconds: 0 },
  },
  {
    fixtureId: 18213979,
    startTime: Date.parse("2026-07-11T21:00:00Z"),
    participant1: "Norway",
    participant2: "England",
    competition: "FIFA World Cup 2026 — Quarterfinal",
    competitionId: 72,
    p1Code: "NOR",
    p2Code: "ENG",
    result: { home: 1, away: 2, label: "AET" },
    recording: { complete: true, seconds: 10_003, unknownOpeningSeconds: 0 },
  },
  {
    fixtureId: 18222446,
    startTime: Date.parse("2026-07-12T01:00:00Z"),
    participant1: "Argentina",
    participant2: "Switzerland",
    competition: "FIFA World Cup 2026 — Quarterfinal",
    competitionId: 72,
    p1Code: "ARG",
    p2Code: "SUI",
    result: { home: 3, away: 1, label: "AET" },
    recording: { complete: true, seconds: 9_871, unknownOpeningSeconds: 0 },
  },
];

const FIXTURES_BY_ID = new Map(
  RECORDED_FIXTURES.map((fixture) => [String(fixture.fixtureId), fixture]),
);

/** Resolve only canonical fixture IDs; malformed and unknown route values miss. */
export function getRecordedFixture(value: string | number): RecordedFixture | undefined {
  const key = String(value);
  if (!/^[1-9]\d*$/.test(key)) return undefined;
  return FIXTURES_BY_ID.get(key);
}

export function fixtureKickoffLabel(startTime: number): string {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(startTime);
}
