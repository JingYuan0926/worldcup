import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  planWorldCupFixtures,
  normalizeWorldCupFixture,
} from "./auto-record-plan.js";

const HOUR = 60 * 60 * 1_000;
const MINUTE = 60 * 1_000;
const NOW = Date.UTC(2026, 6, 11, 12);

describe("auto-record planning", () => {
  it("arms two World Cup fixtures independently and ignores other competitions", () => {
    const plans = planWorldCupFixtures(
      {
        data: [
          { FixtureId: 101, StartTime: NOW + HOUR, CompetitionId: 72, Competition: "FIFA World Cup", Participant1: "A", Participant2: "B" },
          { FixtureId: 102, StartTime: NOW + 2 * HOUR, CompetitionId: 72, Competition: "World Cup", Participant1: { Name: "C" }, Participant2: { Name: "D" } },
          { FixtureId: 103, StartTime: NOW + HOUR, CompetitionId: 99, Competition: "Friendly" },
          { FixtureId: 104, StartTime: NOW + 25 * HOUR, CompetitionId: 72, Competition: "World Cup" },
        ],
      },
      { nowMs: NOW },
    );

    assert.deepEqual(plans.map(({ fixtureId, stage }) => [fixtureId, stage]), [
      [101, "armed"],
      [102, "armed"],
    ]);
    assert.equal(plans[0]?.recordAtMs, NOW + HOUR - 10 * MINUTE);
    assert.equal(plans[1]?.home, "C");
  });

  it("moves from pre-kickoff capture to historical finalization at six hours", () => {
    const payload = [{ FixtureId: 201, StartTime: NOW, CompetitionId: 72, Competition: "World Cup" }];
    assert.equal(planWorldCupFixtures(payload, { nowMs: NOW - 11 * MINUTE })[0]?.stage, "armed");
    assert.equal(planWorldCupFixtures(payload, { nowMs: NOW - 10 * MINUTE })[0]?.stage, "record-due");
    assert.equal(planWorldCupFixtures(payload, { nowMs: NOW + 6 * HOUR })[0]?.stage, "backfill-due");
    assert.equal(
      planWorldCupFixtures(payload, { nowMs: NOW, completeFixtureIds: new Set([201]) })[0]?.stage,
      "complete",
    );
  });

  it("accepts epoch seconds and a World Cup name if the numeric id is absent", () => {
    const fixture = normalizeWorldCupFixture({
      fixtureId: 301,
      startTime: NOW / 1_000,
      competition: "FIFA World Cup 2026",
      home: "Norway",
      away: "England",
    });
    assert.equal(fixture?.startTimeMs, NOW);
    assert.equal(fixture?.home, "Norway");
  });
});
