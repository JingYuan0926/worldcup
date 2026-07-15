import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { foldReplayState } from "./materialize-state.js";

describe("foldReplayState", () => {
  it("preserves fields omitted by a sparse action frame", () => {
    const initial = foldReplayState(null, {
      seq: 10,
      ts: 1_000,
      payload: {
        StatusId: 4,
        GameState: "live",
        Clock: { Seconds: 2_701, Running: true },
        Stats: { "1": 1, "2": 0, "7": 3, "8": 1 },
      },
    });
    const sparse = foldReplayState(initial, {
      seq: 11,
      ts: 2_000,
      payload: { Action: "comment", Participant: 123 },
    });

    assert.equal(sparse.seq, 11);
    assert.equal(sparse.sourceTsMs, 2_000);
    assert.equal(sparse.phase, 4);
    assert.equal(sparse.gameState, "live");
    assert.deepEqual(sparse.clock, { seconds: 2_701, running: true });
    assert.deepEqual(sparse.home, { goals: 1, yellows: 0, reds: 0, corners: 3 });
    assert.deepEqual(sparse.away, { goals: 0, yellows: 0, reds: 0, corners: 1 });
  });

  it("merges nested patches and applies explicit zeroes and corrections", () => {
    const initial = foldReplayState(null, {
      seq: 20,
      ts: 1_000,
      payload: {
        StatusId: 4,
        Clock: { Seconds: 2_800, Running: true },
        Stats: { "1": 1, "2": 0, "7": 3, "8": 1 },
      },
    });
    const corrected = foldReplayState(initial, {
      seq: 21,
      ts: 2_000,
      payload: {
        StatusId: 3,
        Clock: { Seconds: 2_700 },
        Stats: { "1": 0, "8": 2 },
      },
    });

    assert.equal(corrected.phase, 3);
    assert.deepEqual(corrected.clock, { seconds: 2_700, running: true });
    assert.equal(corrected.home.goals, 0);
    assert.equal(corrected.home.corners, 3);
    assert.equal(corrected.away.corners, 2);
  });
});
