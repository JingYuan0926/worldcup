/**
 * Settlement domain model — game phases, pool/stat specs, curated pool
 * templates, and the phase-decision helpers the permissionless crank uses to
 * decide *when* a pool may settle and *which* `seq` carries the settling proof.
 *
 * README refs: §5.1 (pool templates), §5.2 (lifecycle), §7.4 (stat keys &
 * phases), and docs/settlement-spec.md §5 (the PROVISIONAL phase-settlement
 * rule this file encodes). No network, no side effects — pure domain logic so it
 * is trivially unit-testable and safe to import anywhere (including from the
 * CLIs, which run their own `main()` on load).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Game phases (README §7.4). `statusSoccerId` carries one of these ids.
// ─────────────────────────────────────────────────────────────────────────────

/** statusSoccerId → phase name (README §7.4). */
export const PHASE_NAMES: Record<number, string> = {
  1: "NS", // not started
  2: "H1", // first half in play
  3: "HT", // half-time  ← first-half pools settle here
  4: "H2", // second half in play
  5: "F", // full time (regulation) ← full-time pools settle here …
  6: "WET", // waiting for extra time
  7: "ET1", // extra time first half
  8: "HTET", // half-time of extra time
  9: "ET2", // extra time second half
  10: "FET", // full time after extra time ← … accepted as FT terminal
  11: "WPE", // waiting for penalties
  12: "PE", // penalty shoot-out in progress
  13: "FPE", // full time after penalties ← … accepted as FT terminal
  14: "I", // interrupted
  15: "A", // abandoned  → refund
  16: "C", // cancelled  → refund
  17: "TXCC",
  18: "TXCS",
  19: "P", // postponed  → refund
};

/** Half-time phase — the settle phase for first-half COUNT pools. */
export const PHASE_HT = 3;
/** Full-time regulation phase. */
export const PHASE_F = 5;
/**
 * Terminal phases accepted for a full-time (`settle_phase = 5`) pool. A knockout
 * match may end at FET (10, after extra time) or FPE (13, after penalties); the
 * full-game stat is only final at whichever terminal the match actually reaches
 * (README §5.1, §7.4).
 */
export const FT_TERMINAL_PHASES: readonly number[] = [PHASE_F, 10, 13];
/**
 * Phases that route a pool to **refund**, never settle: Abandoned (15),
 * Cancelled (16), Postponed (19) (README §5.2). Interrupted (14) is *not* here —
 * an interrupted match may resume, so the crank keeps waiting.
 */
export const REFUND_PHASES: readonly number[] = [15, 16, 19];

export function phaseName(status: number): string {
  return PHASE_NAMES[status] ?? `?${status}`;
}

/**
 * Coerce a raw `statusSoccerId` (wire shape is PROVISIONAL — number, numeric
 * string, or an object like `{id}` / `{value}`; see docs/wire-notes.md) into a
 * phase id. Returns `undefined` when it cannot be read (never guess a phase).
 */
export function coerceStatusSoccerId(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    for (const k of ["id", "Id", "value", "Value", "status", "Status", "code", "Code"]) {
      const v = rec[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
    }
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pool + stat domain
// ─────────────────────────────────────────────────────────────────────────────

/** Which settlement mechanism a pool uses (docs/settlement-spec.md §2/§3). */
export type PoolKind = "count" | "when";

/** Binary op combining two stat keys (matches the txoracle `BinaryExpression`). */
export type StatOp = "add" | "subtract";

/**
 * The stat(s) a pool settles on. `statKeyA` (+ optional `statKeyB` combined by
 * `op`) are FULL stat keys — period is already encoded as `period*1000 + base`
 * (README §7.4), e.g. `1001` = first-half Participant-1 goals. The proof's leaf
 * carries the split key/value/period back to us.
 */
export interface StatSpec {
  statKeyA: number;
  statKeyB?: number;
  op?: StatOp;
}

/**
 * A curated pool template (README §5.1). `poolIndex` is stable per fixture so
 * the PDA seed `["pool", fixture_id, pool_index]` is deterministic. The bootstrap
 * CLI turns each of these + a fixture's `StartTime` into a `create_pool` plan;
 * the crank uses the same list to know what to settle.
 */
export interface PoolTemplate {
  poolIndex: number;
  label: string;
  kind: PoolKind;
  spec: StatSpec;
  /** `PHASE_HT` (3) or `PHASE_F` (5) — the pool's on-chain `settle_phase`. */
  settlePhase: number;
  /** Inclusive guess bounds (i32). WHEN pools use bucket indices 0..NEVER (20). */
  sliderMin: number;
  sliderMax: number;
  /** WHEN only: which occurrence of the cumulative stat to bracket. */
  eventOrdinal?: number;
}

/** WHEN-pool NEVER bucket index (mirror of packages/payout `NEVER_BUCKET`). */
export const NEVER_BUCKET = 20;
/** 90:00 onward; extra time folds into this bucket in v1. */
export const BEYOND_BUCKET = 18;
/** Milliseconds per 5-minute settlement bucket (docs/settlement-spec.md §3.1). */
export const BUCKET_MS = 300_000;

/**
 * The curated v1 pool set the bootstrapper creates for every fixture (README
 * §5.1 plus the unified-timeline corner/red pools). `poolIndex` values are frozen: do
 * not renumber, they are baked into pool PDAs.
 *
 * Ranges: COUNT bounds from the §5.1 table; WHEN bounds are the bucket-index
 * selectable domain 0..18 plus 20 (18 regulation windows + 18 stoppage/beyond,
 * 19 deliberately unused, 20 NEVER).
 */
export const POOL_TEMPLATES: readonly PoolTemplate[] = [
  {
    poolIndex: 0,
    label: "Total match goals",
    kind: "count",
    spec: { statKeyA: 1, statKeyB: 2, op: "add" },
    settlePhase: PHASE_F,
    sliderMin: 0,
    sliderMax: 10,
  },
  {
    poolIndex: 1,
    label: "Total match corners",
    kind: "count",
    spec: { statKeyA: 7, statKeyB: 8, op: "add" },
    settlePhase: PHASE_F,
    sliderMin: 0,
    sliderMax: 25,
  },
  {
    poolIndex: 2,
    label: "First-half goals",
    kind: "count",
    spec: { statKeyA: 1001, statKeyB: 1002, op: "add" },
    settlePhase: PHASE_HT,
    sliderMin: 0,
    sliderMax: 6,
  },
  {
    poolIndex: 3,
    label: "Window of the 1st goal",
    kind: "when",
    spec: { statKeyA: 1, statKeyB: 2, op: "add" },
    settlePhase: PHASE_F,
    sliderMin: 0,
    sliderMax: NEVER_BUCKET,
    eventOrdinal: 1,
  },
  {
    poolIndex: 4,
    label: "Window of the 1st yellow card",
    kind: "when",
    spec: { statKeyA: 3, statKeyB: 4, op: "add" },
    settlePhase: PHASE_F,
    sliderMin: 0,
    sliderMax: NEVER_BUCKET,
    eventOrdinal: 1,
  },
  {
    poolIndex: 5,
    label: "Window of the 1st corner",
    kind: "when",
    spec: { statKeyA: 7, statKeyB: 8, op: "add" },
    settlePhase: PHASE_F,
    sliderMin: 0,
    sliderMax: NEVER_BUCKET,
    eventOrdinal: 1,
  },
  {
    poolIndex: 6,
    label: "Window of the 1st red card",
    kind: "when",
    spec: { statKeyA: 5, statKeyB: 6, op: "add" },
    settlePhase: PHASE_F,
    sliderMin: 0,
    sliderMax: NEVER_BUCKET,
    eventOrdinal: 1,
  },
];

export function templateByIndex(poolIndex: number): PoolTemplate | undefined {
  return POOL_TEMPLATES.find((t) => t.poolIndex === poolIndex);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase decisions (docs/settlement-spec.md §5 — PROVISIONAL)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is a pool with `settlePhase` eligible to settle given the *observed* phase?
 *
 *  - HT pool (`settlePhase = PHASE_HT`): eligible exactly at HT (3). The first
 *    half's stats (`1001/1002`, …) are final once the match reaches half-time.
 *  - FT pool (`settlePhase = PHASE_F`): eligible at any terminal phase — F (5),
 *    FET (10) or FPE (13). Note this is a *phase-level* check; use
 *    {@link settleSeqFor} to pick the actual settling `seq`, which additionally
 *    requires the match to be truly over (a mid-match F=5 that precedes extra
 *    time is not final).
 */
export function isSettlePhase(status: number, settlePhase: number): boolean {
  if (settlePhase === PHASE_HT) return status === PHASE_HT;
  return FT_TERMINAL_PHASES.includes(status);
}

/** Abandoned / cancelled / postponed → refund path (README §5.2). */
export function isRefundPhase(status: number): boolean {
  return REFUND_PHASES.includes(status);
}

/** Coarse lifecycle classification of an observed phase for a given pool. */
export type PhaseDisposition = "pre_match" | "in_play" | "settle_ready" | "refund" | "unknown";

export function classifyPhase(status: number | undefined, settlePhase: number): PhaseDisposition {
  if (status === undefined) return "unknown";
  if (isRefundPhase(status)) return "refund";
  if (isSettlePhase(status, settlePhase)) return "settle_ready";
  if (status === 1) return "pre_match";
  if (PHASE_NAMES[status] !== undefined) return "in_play";
  return "unknown";
}

/** One phase observation distilled from a Scores record. */
export interface PhaseRecord {
  /** Per-fixture settlement cursor (README §7.3) — this is what we settle on. */
  seq: number;
  /** Coerced `statusSoccerId`. */
  status: number;
  /** Batch min-timestamp (ms) if available — feeds WHEN bucket math. */
  minTimestamp?: number;
}

/**
 * The settle `seq` for a pool — "the seq whose Scores record carries the settle
 * phase" (task spec; docs/settlement-spec.md §5). Returns the chosen record or
 * `undefined` if the match has not reached a settle-ready state yet.
 *
 * Selection rule (deterministic):
 *  - **HT pool:** the FIRST (lowest) `seq` whose `status == 3` (HT). The half is
 *    complete at that record; its H1 stats are final.
 *  - **FT pool:** settle only when the match is genuinely over. We take the
 *    highest-`seq` record and require its `status` to be terminal (5/10/13). A
 *    mid-match F=5 that is followed by extra-time (in-play) records is therefore
 *    NOT picked — later records with a non-terminal phase mean play resumed, so
 *    the full-game stat is not final. Once the match truly ends, the last record
 *    is terminal (F for 90-min games, FET/FPE for ET/penalty knockouts).
 *
 * PROVISIONAL: exactly what the on-chain `validate_stat` proof binds (a whole
 * `seq`'s record vs only a 5-min batch window) is a freeze-blocker in
 * docs/settlement-spec.md §5. If the proof does not bind the phase, the settle
 * instruction needs an independent phase constraint; this selector still names
 * the correct `seq`.
 */
export function settleSeqFor(
  records: readonly PhaseRecord[],
  settlePhase: number,
): PhaseRecord | undefined {
  if (records.length === 0) return undefined;
  const sorted = [...records].sort((a, b) => a.seq - b.seq);

  if (settlePhase === PHASE_HT) {
    return sorted.find((r) => r.status === PHASE_HT);
  }

  // FT: require the latest record to be terminal (match truly over).
  const last = sorted[sorted.length - 1];
  if (last && FT_TERMINAL_PHASES.includes(last.status)) {
    // Walk back to the earliest contiguous terminal record so we bind the moment
    // the match first reached its final terminal phase (stable stat value).
    let chosen = last;
    for (let i = sorted.length - 2; i >= 0; i--) {
      const r = sorted[i];
      if (r && FT_TERMINAL_PHASES.includes(r.status)) chosen = r;
      else break;
    }
    return chosen;
  }
  return undefined;
}

/**
 * Should this pool be refunded? True when the latest observed phase is a refund
 * phase (abandoned/cancelled/postponed). The deadline-based refund path (now >
 * settle_deadline_ts) is handled separately by the crank (README §5.2).
 */
export function shouldRefund(records: readonly PhaseRecord[]): boolean {
  if (records.length === 0) return false;
  const last = [...records].sort((a, b) => a.seq - b.seq)[records.length - 1];
  return last !== undefined && isRefundPhase(last.status);
}
