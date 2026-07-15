/**
 * The permissionless settle crank (README §4 component 3, §6, TASKS Phase 2).
 *
 * Anyone can run this — there is no admin key. It watches a fixture's phase,
 * detects HT / full-time (and abandonment), picks the settle `seq`, fetches the
 * TxLINE Merkle proof(s), builds the settle tx, and — once the `exact_match`
 * program is deployed — submits it. Until then it logs the full plan + proof +
 * CPI args so the whole path is verifiable pre-deploy. It also runs the
 * deadline-based refund path (README §5.2).
 *
 * `runCrankOnce` is a single, side-effect-light evaluation (fetch + plan) that
 * returns a structured result — the CLI's dry-run and any test driver call it.
 * `runCrank` is the thin polling loop around it for live use.
 */
import { Connection } from "@solana/web3.js";
import type { TxlineClient } from "../../ingest/src/txline/client.js";
import type { TxlineNetwork } from "../../ingest/src/txline/networks.js";
import { logger } from "../../ingest/src/util/log.js";
import {
  POOL_TEMPLATES,
  classifyPhase,
  phaseName,
  settleSeqFor,
  shouldRefund,
  type PhaseRecord,
  type PoolTemplate,
} from "./phase.js";
import {
  fetchBracketingProofs,
  fetchScores,
  fetchStatValidation,
  pickWhenSeqs,
  recordsToPhaseRecords,
  recordsToSeqStats,
  type WhenSeqSelection,
} from "./proofs.js";
import {
  buildRefundTx,
  buildSettleCountTx,
  buildSettleWhenTx,
  exactMatchProgramId,
  type RefundPlan,
  type SettlePlan,
} from "./settle.js";

const log = logger("settler:crank");

const SETTLE_DEADLINE_MS = 12 * 60 * 60 * 1000; // lock_ts + 12h (README §5.2)

export interface CrankOptions {
  client: TxlineClient;
  network: TxlineNetwork;
  fixtureId: number;
  /** Kickoff (ms) = pool `lock_ts`; from `fetchFixture`. Needed for buckets/deadline. */
  lockTsMs: number;
  /** Pools to act on. Default: all curated templates. Pass a subset to target one. */
  templates?: readonly PoolTemplate[];
  /** When false AND the program is deployed, actually submit. Default true. */
  dryRun?: boolean;
  /** Injectable clock for tests. */
  nowMs?: number;
}

/** Per-pool outcome of one crank pass. */
export interface PoolOutcome {
  poolIndex: number;
  label: string;
  disposition: "settle_ready" | "refund" | "pending" | "error";
  /** Observed latest phase id + name (context for logs). */
  latestStatus?: { id: number; name: string };
  settleSeq?: number;
  plan?: SettlePlan;
  refund?: RefundPlan;
  note: string;
}

export interface CrankResult {
  fixtureId: number;
  observedRecords: number;
  latestSeq?: number;
  latestStatus?: { id: number; name: string };
  outcomes: PoolOutcome[];
  /** True when every targeted pool reached a terminal outcome (settle/refund). */
  allResolved: boolean;
}

/**
 * One crank evaluation: fetch scores once, then for each pool decide settle /
 * refund / pending and build the corresponding plan. Never throws — per-pool
 * failures are captured as `disposition: "error"`.
 */
export async function runCrankOnce(opts: CrankOptions): Promise<CrankResult> {
  const templates = opts.templates ?? POOL_TEMPLATES;
  const nowMs = opts.nowMs ?? Date.now();

  const payload = await fetchScores(opts.client, opts.fixtureId);
  const phaseRecords: PhaseRecord[] = recordsToPhaseRecords(payload);
  const latest = phaseRecords[phaseRecords.length - 1];
  const latestStatus = latest ? { id: latest.status, name: phaseName(latest.status) } : undefined;

  const abandoned = shouldRefund(phaseRecords);
  const outcomes: PoolOutcome[] = [];

  for (const t of templates) {
    try {
      outcomes.push(
        await evaluatePool(opts, t, phaseRecords, { nowMs, abandoned, latestStatus }),
      );
    } catch (e) {
      outcomes.push({
        poolIndex: t.poolIndex,
        label: t.label,
        disposition: "error",
        ...(latestStatus ? { latestStatus } : {}),
        note: `error: ${(e as Error).message.slice(0, 200)}`,
      });
    }
  }

  const allResolved =
    outcomes.length > 0 &&
    outcomes.every((o) => o.disposition === "settle_ready" || o.disposition === "refund");

  return {
    fixtureId: opts.fixtureId,
    observedRecords: phaseRecords.length,
    ...(latest ? { latestSeq: latest.seq } : {}),
    ...(latestStatus ? { latestStatus } : {}),
    outcomes,
    allResolved,
  };
}

async function evaluatePool(
  opts: CrankOptions,
  t: PoolTemplate,
  phaseRecords: PhaseRecord[],
  ctx: { nowMs: number; abandoned: boolean; latestStatus?: { id: number; name: string } },
): Promise<PoolOutcome> {
  const base = {
    poolIndex: t.poolIndex,
    label: t.label,
    ...(ctx.latestStatus ? { latestStatus: ctx.latestStatus } : {}),
  };

  // 1) Abandoned / cancelled / postponed → refund immediately (README §5.2).
  if (ctx.abandoned) {
    const refund = buildRefundTx({
      network: opts.network,
      fixtureId: opts.fixtureId,
      poolIndex: t.poolIndex,
      lockTsMs: opts.lockTsMs,
      reason: "match_abandoned",
      nowMs: ctx.nowMs,
    });
    return { ...base, disposition: "refund", refund, note: refund.summary };
  }

  // 2) Settle-ready? Pick the settle seq for this pool's phase.
  const settleRec = settleSeqFor(phaseRecords, t.settlePhase);
  if (settleRec) {
    const plan =
      t.kind === "count"
        ? await planCount(opts, t, settleRec.seq)
        : await planWhen(opts, t, phaseRecords, settleRec.seq);
    return {
      ...base,
      disposition: "settle_ready",
      settleSeq: settleRec.seq,
      plan,
      note: plan.summary,
    };
  }

  // 3) Not settle-ready. Deadline refund if past lock_ts + 12h.
  if (ctx.nowMs > opts.lockTsMs + SETTLE_DEADLINE_MS) {
    const refund = buildRefundTx({
      network: opts.network,
      fixtureId: opts.fixtureId,
      poolIndex: t.poolIndex,
      lockTsMs: opts.lockTsMs,
      reason: "deadline_passed",
      nowMs: ctx.nowMs,
    });
    return { ...base, disposition: "refund", refund, note: refund.summary };
  }

  // 4) Still waiting.
  const disp = classifyPhase(ctx.latestStatus?.id, t.settlePhase);
  return {
    ...base,
    disposition: "pending",
    note: `pending — phase ${ctx.latestStatus?.name ?? "unknown"} (${disp}); waiting for phase ${t.settlePhase}`,
  };
}

/** Build the COUNT settle plan by fetching the single exact-value proof. */
async function planCount(
  opts: CrankOptions,
  t: PoolTemplate,
  settleSeq: number,
): Promise<SettlePlan> {
  const proof = await fetchStatValidation(opts.client, {
    fixtureId: opts.fixtureId,
    seq: settleSeq,
    statKey: t.spec.statKeyA,
    ...(t.spec.statKeyB !== undefined ? { statKey2: t.spec.statKeyB } : {}),
  });
  return buildSettleCountTx({
    network: opts.network,
    template: t,
    fixtureId: opts.fixtureId,
    settleSeq,
    proof,
  });
}

/** Build the WHEN settle plan: derive the cumulative series, pick the bracketing
 *  seqs, fetch proof A/B (or the terminal NEVER proof), and assemble the plan. */
async function planWhen(
  opts: CrankOptions,
  t: PoolTemplate,
  phaseRecords: PhaseRecord[],
  _settleSeq: number,
): Promise<SettlePlan> {
  const payload = await fetchScores(opts.client, opts.fixtureId);
  const series = recordsToSeqStats(payload, t.spec);
  const eventOrdinal = t.eventOrdinal ?? 1;

  let sel: WhenSeqSelection;
  if (series.length > 0) {
    sel = pickWhenSeqs(series, eventOrdinal);
  } else {
    // No cumulative series available (stats map absent for this fixture yet):
    // fall back to a NEVER settle at the terminal seq so the pool still resolves.
    const terminal = phaseRecords[phaseRecords.length - 1];
    sel = { eventOrdinal, ...(terminal ? { terminalSeq: terminal.seq } : {}) };
  }

  const brackets = await fetchBracketingProofs(opts.client, opts.fixtureId, t.spec, sel, opts.lockTsMs);
  return buildSettleWhenTx({
    network: opts.network,
    template: t,
    fixtureId: opts.fixtureId,
    brackets,
    sel,
  });
}

/** Log a crank result compactly. */
export function logCrankResult(res: CrankResult, dryRun: boolean): void {
  log.info(
    `fixture ${res.fixtureId}: ${res.observedRecords} record(s), ` +
      `latest ${res.latestStatus ? `${res.latestStatus.name}(${res.latestStatus.id})` : "?"} @ seq ${res.latestSeq ?? "?"}`,
  );
  for (const o of res.outcomes) {
    const tag = o.disposition.toUpperCase().padEnd(12);
    log.info(`  [${tag}] pool ${o.poolIndex} ${o.label}: ${o.note}`);
    const plan = o.plan;
    if (plan && plan.kind === "count") {
      log.info(
        `      validate_stat: EqualTo ${plan.claimedActual}; ` +
          `proofs f=${plan.validate.proofSizes.fixtureProof} m=${plan.validate.proofSizes.mainTreeProof} ` +
          `a=${plan.validate.proofSizes.statAProof} b=${plan.validate.proofSizes.statBProof ?? "-"}; ` +
          `rootPDA ${plan.validate.dailyScoresRootsPda}`,
      );
    } else if (plan && plan.kind === "when") {
      const calls = [plan.validateA, plan.validateB, plan.validateNever].filter(Boolean).length;
      log.info(`      settle_when: bucket ${plan.claimedBucket}, ${calls} CPI(s), seqs=${JSON.stringify(plan.seqs)}`);
    }
    if (o.refund) log.info(`      ${o.refund.summary}`);
  }
  if (!dryRun && !exactMatchProgramId()) {
    log.warn("  submit requested but EXACT_MATCH_PROGRAM_ID is unset — program not deployed; logged plan only");
  }
  // TODO(program): when EXACT_MATCH_PROGRAM_ID is set and !dryRun, submit each
  // settle_ready plan's instruction and each eligible refund; confirm on-chain.
}

export interface CrankLoopHandle {
  stop(): void;
  /** Resolves when the loop ends (all resolved, max passes, or stop()). */
  done: Promise<void>;
}

/**
 * Poll `runCrankOnce` every `intervalMs` until all pools resolve, `maxPasses` is
 * hit, or `stop()` is called. Returns a handle immediately. Submission is still
 * deploy-gated (see `logCrankResult`); this drives the watch + plan/log cycle.
 */
export function runCrank(
  opts: CrankOptions & { intervalMs?: number; maxPasses?: number; connection?: Connection },
): CrankLoopHandle {
  const intervalMs = opts.intervalMs ?? 30_000;
  const maxPasses = opts.maxPasses ?? Number.POSITIVE_INFINITY;
  const dryRun = opts.dryRun ?? true;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  const finish = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    resolveDone();
  };

  let passes = 0;
  const tick = async (): Promise<void> => {
    if (stopped) return finish();
    passes++;
    try {
      const res = await runCrankOnce(opts);
      logCrankResult(res, dryRun);
      if (res.allResolved) {
        log.info("all pools resolved — crank done");
        return finish();
      }
    } catch (e) {
      log.error("crank pass failed", (e as Error).message);
    }
    if (passes >= maxPasses) {
      log.info(`reached maxPasses=${maxPasses} — stopping`);
      return finish();
    }
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  };

  void tick();
  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      finish();
    },
    done,
  };
}
