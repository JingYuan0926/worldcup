import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { computePayouts, medianError, acc, type EntryInput } from "../src/index.js";

interface Vector {
  name: string;
  description: string;
  actual: number;
  entries?: { guess: number; stake: string }[];
  generate?: { count: number; guess: number; stake: string };
  expected: {
    medianError: number;
    losersPot: string;
    vault: string;
    totalPayout: string;
    dust: string;
    winners?: boolean[];
    payouts?: string[];
    allWinners?: boolean;
    eachPayout?: string;
  };
}

const vectorsPath = resolve(import.meta.dirname, "../../../docs/payout-vectors.json");
const doc = JSON.parse(readFileSync(vectorsPath, "utf8")) as { vectors: Vector[] };

function entriesOf(v: Vector): EntryInput[] {
  if (v.generate) {
    return Array.from({ length: v.generate.count }, () => ({
      guess: v.generate!.guess,
      stake: BigInt(v.generate!.stake),
    }));
  }
  return (v.entries ?? []).map((e) => ({ guess: e.guess, stake: BigInt(e.stake) }));
}

describe("acc()", () => {
  it("ACC(0) = 1_000_000, and is steep", () => {
    expect(acc(0)).toBe(1_000_000n);
    expect(acc(1)).toBe(500_000n);
    expect(acc(2)).toBe(200_000n);
    expect(acc(3)).toBe(100_000n);
  });
});

describe("medianError()", () => {
  it("odd count → middle value", () => {
    expect(medianError([0, 1, 2, 3, 10])).toBe(2);
  });
  it("even count → lower of the two middle values", () => {
    expect(medianError([0, 1, 2, 3])).toBe(1);
  });
  it("empty → 0", () => {
    expect(medianError([])).toBe(0);
  });
});

describe("payout vectors (cross-language contract)", () => {
  for (const v of doc.vectors) {
    it(`${v.name}: ${v.description}`, () => {
      const entries = entriesOf(v);
      const res = computePayouts(entries, v.actual);

      // Scalar expectations.
      expect(res.medianError).toBe(v.expected.medianError);
      expect(res.losersPot).toBe(BigInt(v.expected.losersPot));
      expect(res.vault).toBe(BigInt(v.expected.vault));
      expect(res.totalPayout).toBe(BigInt(v.expected.totalPayout));
      expect(res.dust).toBe(BigInt(v.expected.dust));

      // Per-entry expectations (explicit or generated form).
      if (v.expected.payouts) {
        expect(res.entries.map((e) => e.payout.toString())).toEqual(v.expected.payouts);
      }
      if (v.expected.winners) {
        expect(res.entries.map((e) => e.isWinner)).toEqual(v.expected.winners);
      }
      if (v.expected.allWinners !== undefined) {
        expect(res.entries.every((e) => e.isWinner)).toBe(v.expected.allWinners);
      }
      if (v.expected.eachPayout) {
        const each = BigInt(v.expected.eachPayout);
        expect(res.entries.every((e) => e.payout === each)).toBe(true);
      }

      // Universal invariants (must hold for EVERY pool).
      expect(res.totalPayout).toBeLessThanOrEqual(res.vault); // conservation
      expect(res.dust).toBeGreaterThanOrEqual(0n);
      for (const e of res.entries) {
        if (e.isWinner) expect(e.payout).toBeGreaterThanOrEqual(e.stake);
        else expect(e.payout).toBe(0n);
      }
    });
  }
});
