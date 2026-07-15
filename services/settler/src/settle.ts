/**
 * Settle tx BUILDERS — deploy-gated scaffold.
 *
 * The `exact_match` Anchor program does not exist yet (it is built last, README
 * TASKS Phase 1 tail / "smart contract LAST"). Everything that does NOT depend on
 * our program is built for real here:
 *   - the `validate_stat` CPI args (via `buildValidateStatArgs`) that our
 *     `settle` / `settle_when` instructions will forward to txoracle,
 *   - the `daily_scores_roots` PDA (README §7.6),
 *   - the pool PDA + Token-2022 vault ATA (README §6 seeds), when the program id
 *     is known.
 *
 * Each builder returns a `SettlePlan` / `RefundPlan` DESCRIPTION object — exactly
 * what WOULD be submitted — so the crank and CLI can log, diff and (later)
 * submit it. The single missing piece is marked `TODO(program)`: wiring these
 * args + accounts into `exactMatchProgram.methods.settle(...)` and sending the
 * tx. Nothing else changes when the program lands.
 */
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { TxlineNetwork } from "../../ingest/src/txline/networks.js";
import type { NormalizedProof, ValidateStatArgs } from "../../ingest/src/txline/txoracle.js";
import {
  buildValidateStatArgs,
  dailyScoresRootsPda,
  epochDayFromTs,
  Comparison,
  BinaryExpression,
} from "../../ingest/src/txline/txoracle.js";
import type { PoolTemplate, StatSpec } from "./phase.js";
import { NEVER_BUCKET } from "./phase.js";
import type { BracketProofs, WhenSeqSelection } from "./proofs.js";
import { proofStatValue } from "./proofs.js";

// ─────────────────────────────────────────────────────────────────────────────
// exact_match program id + PDAs (deploy-gated)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The `exact_match` program id, from `EXACT_MATCH_PROGRAM_ID` env once deployed.
 * Returns `null` until then — plans still render (with `poolPda: null`) so the
 * whole settle path is loggable/testable pre-deploy.
 */
export function exactMatchProgramId(): PublicKey | null {
  const raw = process.env.EXACT_MATCH_PROGRAM_ID;
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
}

/** Pool PDA: seeds `["pool", i64_LE(fixture_id), u8(pool_index)]` (README §6). */
export function poolPda(
  programId: PublicKey,
  fixtureId: number,
  poolIndex: number,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), new BN(fixtureId).toArrayLike(Buffer, "le", 8), Buffer.from([poolIndex])],
    programId,
  );
  return pda;
}

/** The pool's USDT vault = Token-2022 ATA owned by the pool PDA (README §6). */
export function poolVault(poolPdaKey: PublicKey, usdtMint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(usdtMint, poolPdaKey, true, TOKEN_2022_PROGRAM_ID);
}

/** Resolved on-chain accounts for a settle/refund, or the seed recipe if the
 *  program id is unknown (pre-deploy). */
export interface PoolAccounts {
  programId: string | null;
  poolPda: string | null;
  vault: string | null;
  /** Human recipe so the plan is self-describing even before the program exists. */
  poolSeeds: string;
}

function resolvePoolAccounts(
  network: TxlineNetwork,
  fixtureId: number,
  poolIndex: number,
): PoolAccounts {
  const programId = exactMatchProgramId();
  const poolSeeds = `["pool", i64_le(${fixtureId}), u8(${poolIndex})]`;
  if (!programId) {
    return { programId: null, poolPda: null, vault: null, poolSeeds };
  }
  const pda = poolPda(programId, fixtureId, poolIndex);
  return {
    programId: programId.toBase58(),
    poolPda: pda.toBase58(),
    vault: poolVault(pda, network.usdtMint).toBase58(),
    poolSeeds,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan description objects (what WOULD be submitted)
// ─────────────────────────────────────────────────────────────────────────────

/** A single `validate_stat` CPI the program will make, described for logging. */
export interface ValidateStatCall {
  /** ts (ms) = summary.update_stats.min_timestamp. */
  ts: number;
  epochDay: number;
  dailyScoresRootsPda: string;
  /** { threshold, comparison } as passed to the CPI. */
  predicate: { threshold: number; comparison: "EqualTo" | "GreaterThan" | "LessThan" };
  /** "add" | "subtract" | null. */
  op: "add" | "subtract" | null;
  /** Observed stat value(s) from the proof leaf (a, b, a±b). */
  observed: { a: number; b: number | null; combined: number };
  /** Vec lengths — feed the CU / 1232-byte size budget (README §7.5, spike #4). */
  proofSizes: { fixtureProof: number; mainTreeProof: number; statAProof: number; statBProof: number | null };
  /** The exact ordered args for txoracle::validate_stat (kept for submission). */
  args: ValidateStatArgs;
}

export interface SettleCountPlan {
  kind: "count";
  fixtureId: number;
  poolIndex: number;
  statSpec: StatSpec;
  settlePhase: number;
  /** The seq whose Scores record carries the settle phase (phase.settleSeqFor). */
  settleSeq: number;
  claimedActual: number;
  accounts: PoolAccounts;
  /** The one CPI a COUNT settle makes. */
  validate: ValidateStatCall;
  /** exact_match instruction this maps onto (deploy-gated). */
  instruction: "settle";
  summary: string;
}

export interface SettleWhenPlan {
  kind: "when";
  fixtureId: number;
  poolIndex: number;
  statSpec: StatSpec;
  settlePhase: number;
  eventOrdinal: number;
  claimedBucket: number;
  /** true when the event never occurred → single terminal proof. */
  never: boolean;
  seqs: { beforeSeq: number | null; insideSeq: number | null; terminalSeq: number | null };
  accounts: PoolAccounts;
  /** proof A (`==N-1`), proof B (`>=N`), or the single terminal NEVER proof. */
  validateA: ValidateStatCall | null;
  validateB: ValidateStatCall | null;
  validateNever: ValidateStatCall | null;
  instruction: "settle_when";
  summary: string;
}

export interface RefundPlan {
  kind: "refund";
  fixtureId: number;
  poolIndex: number;
  reason: "deadline_passed" | "match_abandoned";
  /** lock_ts + 12h (README §5.2). Refunds allowed only after this (deadline path). */
  settleDeadlineTs: number;
  nowTs: number;
  accounts: PoolAccounts;
  instruction: "refund";
  summary: string;
}

export type SettlePlan = SettleCountPlan | SettleWhenPlan;

// ─────────────────────────────────────────────────────────────────────────────
// Builders
// ─────────────────────────────────────────────────────────────────────────────

/** Assemble one `ValidateStatCall` description from a normalised proof. */
function buildValidateCall(
  network: TxlineNetwork,
  proof: NormalizedProof,
  predicate: { threshold: number; comparison: "EqualTo" | "GreaterThan" | "LessThan" },
  spec: StatSpec,
): ValidateStatCall {
  const comparison =
    predicate.comparison === "EqualTo"
      ? Comparison.EqualTo
      : predicate.comparison === "GreaterThan"
        ? Comparison.GreaterThan
        : Comparison.LessThan;
  const op = spec.statKeyB !== undefined ? (spec.op ?? "add") : null;
  const opArg = op === "add" ? BinaryExpression.Add : op === "subtract" ? BinaryExpression.Subtract : null;

  const args = buildValidateStatArgs(proof, {
    predicate: { threshold: predicate.threshold, comparison },
    op: opArg,
  });

  const ts = proof.summary.update_stats.min_timestamp;
  const epochDay = epochDayFromTs(ts);
  const a = proof.stat_a.stat_to_prove.value;
  const b = proof.stat_b?.stat_to_prove.value ?? null;

  return {
    ts,
    epochDay,
    dailyScoresRootsPda: dailyScoresRootsPda(network, epochDay).toBase58(),
    predicate: { threshold: predicate.threshold, comparison: predicate.comparison },
    op,
    observed: { a, b, combined: proofStatValue(proof) },
    proofSizes: {
      fixtureProof: proof.fixture_proof.length,
      mainTreeProof: proof.main_tree_proof.length,
      statAProof: proof.stat_a.stat_proof.length,
      statBProof: proof.stat_b ? proof.stat_b.stat_proof.length : null,
    },
    args,
  };
}

/**
 * Build the COUNT settle plan (docs/settlement-spec.md §2). One `validate_stat`
 * CPI asserting `(a [+/- b]) == claimed_actual` (EqualTo). `claimedActual`
 * defaults to the proof's observed combined value.
 *
 * TODO(program): submit as
 *   exactMatchProgram.methods
 *     .settle(new BN(call.ts), summary, fixtureProof, mainTreeProof, claimedActual)
 *     .accounts({ pool, vault, dailyScoresMerkleRoots, txoracleProgram, ... })
 *     .instruction();
 * Our program rebuilds the predicate from `claimedActual` and CPIs validate_stat
 * with `call.args`. The bytes/CU are already known from `call.proofSizes`.
 */
export function buildSettleCountTx(opts: {
  network: TxlineNetwork;
  template: PoolTemplate;
  fixtureId: number;
  settleSeq: number;
  proof: NormalizedProof;
  claimedActual?: number;
}): SettleCountPlan {
  const { network, template, fixtureId, settleSeq, proof } = opts;
  const claimedActual = opts.claimedActual ?? proofStatValue(proof);
  const validate = buildValidateCall(
    network,
    proof,
    { threshold: claimedActual, comparison: "EqualTo" },
    template.spec,
  );
  const accounts = resolvePoolAccounts(network, fixtureId, template.poolIndex);

  const opStr = template.spec.statKeyB !== undefined ? ` ${template.spec.op ?? "add"} k${template.spec.statKeyB}` : "";
  const summary =
    `settle COUNT "${template.label}" fixture ${fixtureId} pool ${template.poolIndex} @ seq ${settleSeq}: ` +
    `(k${template.spec.statKeyA}${opStr}) EqualTo ${claimedActual}` +
    (validate.observed.combined === claimedActual
      ? ` [proof shows ${validate.observed.combined} ✓]`
      : ` [⚠ proof shows ${validate.observed.combined} — would PredicateFailed]`);

  return {
    kind: "count",
    fixtureId,
    poolIndex: template.poolIndex,
    statSpec: template.spec,
    settlePhase: template.settlePhase,
    settleSeq,
    claimedActual,
    accounts,
    validate,
    instruction: "settle",
    summary,
  };
}

/**
 * Build the WHEN settle plan (docs/settlement-spec.md §3). Two bracketing CPIs
 * (proof A `== N-1` EqualTo, proof B `>= N` GreaterThan N-1) or a single
 * terminal CPI (`<= N-1` LessThan N) for NEVER. `claimedBucket` comes from proof
 * B's batch window relative to kickoff (already computed in `brackets.bucket`).
 *
 * TODO(program): submit as
 *   exactMatchProgram.methods
 *     .settleWhen(proofA…, proofB…, claimedBucket)      // or (terminalProof…, NEVER)
 *     .accounts({ pool, vault, dailyScoresMerkleRoots, txoracleProgram, ... })
 *     .instruction();
 * The program makes the two CPIs with `validateA.args` / `validateB.args`
 * (or `validateNever.args`) and checks the batch-window consistency (A strictly
 * before B; B's window == claimed bucket). Two proofs may exceed one tx —
 * spike #4 decides one-tx vs a store-A-then-settle-B two-step.
 */
export function buildSettleWhenTx(opts: {
  network: TxlineNetwork;
  template: PoolTemplate;
  fixtureId: number;
  brackets: BracketProofs;
  /** The seq selection that produced `brackets` — supplies the plan's seqs. */
  sel: WhenSeqSelection;
}): SettleWhenPlan {
  const { network, template, fixtureId, brackets, sel } = opts;
  const n = brackets.eventOrdinal;
  const accounts = resolvePoolAccounts(network, fixtureId, template.poolIndex);
  const never = brackets.neverProof !== undefined;

  let validateA: ValidateStatCall | null = null;
  let validateB: ValidateStatCall | null = null;
  let validateNever: ValidateStatCall | null = null;

  if (never && brackets.neverProof) {
    // NEVER: single terminal proof, `stat <= N-1` == LessThan N.
    validateNever = buildValidateCall(
      network,
      brackets.neverProof,
      { threshold: n, comparison: "LessThan" },
      template.spec,
    );
  } else {
    if (brackets.proofA) {
      // Proof A: `stat == N-1`.
      validateA = buildValidateCall(
        network,
        brackets.proofA,
        { threshold: n - 1, comparison: "EqualTo" },
        template.spec,
      );
    }
    if (brackets.proofB) {
      // Proof B: `stat >= N` == GreaterThan (N-1) (tolerates two events / batch).
      validateB = buildValidateCall(
        network,
        brackets.proofB,
        { threshold: n - 1, comparison: "GreaterThan" },
        template.spec,
      );
    }
  }

  const claimedBucket = never ? NEVER_BUCKET : brackets.bucket;
  const summary = never
    ? `settle WHEN "${template.label}" fixture ${fixtureId} pool ${template.poolIndex}: ` +
      `event #${n} NEVER (terminal proof k${template.spec.statKeyA} LessThan ${n}) → bucket ${NEVER_BUCKET}`
    : `settle WHEN "${template.label}" fixture ${fixtureId} pool ${template.poolIndex}: ` +
      `event #${n} crossed in bucket ${claimedBucket} ` +
      `(A: ==${n - 1}${brackets.proofA ? "" : " [MISSING]"}, B: >=${n})`;

  return {
    kind: "when",
    fixtureId,
    poolIndex: template.poolIndex,
    statSpec: template.spec,
    settlePhase: template.settlePhase,
    eventOrdinal: n,
    claimedBucket,
    never,
    seqs: {
      beforeSeq: sel.beforeSeq ?? null,
      insideSeq: sel.insideSeq ?? null,
      terminalSeq: sel.terminalSeq ?? null,
    },
    accounts,
    validateA,
    validateB,
    validateNever,
    instruction: "settle_when",
    summary,
  };
}

/**
 * Build a refund plan (README §5.2). Refunds are allowed only after
 * `settle_deadline_ts = lock_ts + 12h` and while the pool is not Settled, OR
 * immediately when the match is abandoned/cancelled/postponed (routed by the
 * crank via `shouldRefund`). No proof is needed.
 *
 * TODO(program): submit per-entrant as
 *   exactMatchProgram.methods.refund().accounts({ pool, vault, entrant, ... }).instruction();
 * `refund()` requires `now > settle_deadline_ts` (deadline path) and returns the
 * entrant's stake.
 */
export function buildRefundTx(opts: {
  network: TxlineNetwork;
  fixtureId: number;
  poolIndex: number;
  lockTsMs: number;
  reason: "deadline_passed" | "match_abandoned";
  nowMs?: number;
}): RefundPlan {
  const { network, fixtureId, poolIndex, lockTsMs, reason } = opts;
  const nowMs = opts.nowMs ?? Date.now();
  const settleDeadlineTs = lockTsMs + 12 * 60 * 60 * 1000; // lock_ts + 12h
  const accounts = resolvePoolAccounts(network, fixtureId, poolIndex);
  const eligible = reason === "match_abandoned" || nowMs > settleDeadlineTs;

  const summary =
    `refund fixture ${fixtureId} pool ${poolIndex} (${reason}); ` +
    `deadline ${new Date(settleDeadlineTs).toISOString()} ` +
    (eligible ? "→ ELIGIBLE now" : `→ not yet (waits until deadline)`);

  return {
    kind: "refund",
    fixtureId,
    poolIndex,
    reason,
    settleDeadlineTs,
    nowTs: nowMs,
    accounts,
    instruction: "refund",
    summary,
  };
}
