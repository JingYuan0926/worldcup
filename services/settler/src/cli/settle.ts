#!/usr/bin/env -S npx tsx
/**
 * Permissionless settle CLI (README §4 component 3, §6; TASKS Phase 2).
 *
 *   npm run settle -- --fixture 17588310 --network devnet
 *   npm run settle -- --fixture 17588310 --pool 1            # just the corners pool
 *   npm run settle -- --fixture 17588310 --lock-ts 1718900000000
 *   npm run settle -- --fixture 17588310 --submit            # once the program is deployed
 *
 * Anyone can run it — there is no admin key (README §6, a headline feature). It
 * watches the fixture's phase, picks the settle `seq`, fetches the TxLINE Merkle
 * proof(s), builds the settle tx and prints the full plan. It defaults to
 * DRY-RUN and only *describes* the tx until the `exact_match` program is deployed
 * (`EXACT_MATCH_PROGRAM_ID`), at which point `--submit` sends it.
 *
 * With no saved TxLINE token it prints the auth hint and exits 0 (subscribe is
 * currently blocked on funding).
 */
import { loadConfig } from "../../../ingest/src/config.js";
import type { NetworkName } from "../../../ingest/src/txline/networks.js";
import { logger } from "../../../ingest/src/util/log.js";
import { POOL_TEMPLATES, type PoolTemplate } from "../phase.js";
import { authHint, fetchFixture, fetchScores, loadSettlerClient, recordsToPhaseRecords } from "../proofs.js";
import { exactMatchProgramId } from "../settle.js";
import { logCrankResult, runCrankOnce } from "../crank.js";

const log = logger("cli:settle");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const network = (arg("network") ?? process.env.TXLINE_NETWORK ?? "devnet") as NetworkName;
  const fixtureArg = arg("fixture");
  if (!fixtureArg) {
    log.error("missing --fixture <id>. e.g. npm run settle -- --fixture 17588310 --network devnet");
    process.exit(1);
  }
  const fixtureId = Number(fixtureArg);
  const poolArg = arg("pool");
  const dryRun = !hasFlag("submit"); // default DRY-RUN true (README/task: until deployed)
  const cfg = loadConfig(network);

  // ── token gate ─────────────────────────────────────────────────────────────
  const client = loadSettlerClient(cfg.tokensDir, network);
  if (!client) {
    log.warn(authHint(network));
    log.info("The settle path is ready to run once a token exists; exiting cleanly.");
    process.exit(0);
  }

  // ── select pools ───────────────────────────────────────────────────────────
  let templates: readonly PoolTemplate[] = POOL_TEMPLATES;
  if (poolArg !== undefined) {
    const idx = Number(poolArg);
    const t = POOL_TEMPLATES.find((x) => x.poolIndex === idx);
    if (!t) {
      log.error(`no pool template with index ${idx}. valid: ${POOL_TEMPLATES.map((x) => x.poolIndex).join(", ")}`);
      process.exit(1);
    }
    templates = [t];
  }

  // ── resolve lock_ts (kickoff) ──────────────────────────────────────────────
  const lockTsMs = await resolveLockTs(client, fixtureId, arg("lock-ts"));

  log.info(
    `settle plan for fixture ${fixtureId} on ${network} (${dryRun ? "DRY-RUN" : "SUBMIT"}); ` +
      `pools: ${templates.map((t) => t.poolIndex).join(",")}; lock_ts ${new Date(lockTsMs).toISOString()}`,
  );
  if (!dryRun && !exactMatchProgramId()) {
    log.warn("--submit given but EXACT_MATCH_PROGRAM_ID is unset (program not deployed) — will log the plan only.");
  }

  const res = await runCrankOnce({ client, network: cfg.network, fixtureId, lockTsMs, templates, dryRun });
  logCrankResult(res, dryRun);

  // Full machine-readable plan dump (proof args elided for readability).
  const dump = res.outcomes.map((o) => ({
    poolIndex: o.poolIndex,
    label: o.label,
    disposition: o.disposition,
    settleSeq: o.settleSeq,
    plan: o.plan ? summarizePlan(o.plan) : undefined,
    refund: o.refund ? { reason: o.refund.reason, settleDeadlineTs: o.refund.settleDeadlineTs } : undefined,
  }));
  // eslint-disable-next-line no-console
  console.log("\n" + JSON.stringify({ fixtureId, dryRun, outcomes: dump }, null, 2) + "\n");

  log.info(res.allResolved ? "all targeted pools resolved" : "some pools still pending — re-run when the match progresses");
}

/** Kickoff from the fixtures snapshot; else the earliest scores ts; else --lock-ts. */
async function resolveLockTs(
  client: NonNullable<Awaited<ReturnType<typeof loadSettlerClient>>>,
  fixtureId: number,
  override?: string,
): Promise<number> {
  if (override !== undefined && Number.isFinite(Number(override))) return Number(override);
  const fx = await fetchFixture(client, fixtureId).catch(() => undefined);
  if (fx) {
    log.info(`kickoff from fixtures snapshot: ${fx.participant1 ?? "?"} v ${fx.participant2 ?? "?"}`);
    return fx.startTimeMs;
  }
  // Finished fixtures leave the upcoming snapshot — estimate kickoff from the
  // earliest scores record timestamp (documented fallback).
  const payload = await fetchScores(client, fixtureId).catch(() => []);
  const recs = recordsToPhaseRecords(payload);
  const earliest = recs.map((r) => r.minTimestamp).filter((t): t is number => typeof t === "number").sort((a, b) => a - b)[0];
  if (earliest !== undefined) {
    log.warn(`fixture not in snapshot; estimating lock_ts from earliest scores ts ${new Date(earliest).toISOString()}`);
    return earliest;
  }
  log.warn("could not resolve lock_ts (no snapshot, no scores ts) — using now(); pass --lock-ts to be exact.");
  return Date.now();
}

function summarizePlan(plan: import("../settle.js").SettlePlan) {
  if (plan.kind === "count") {
    return {
      kind: plan.kind,
      instruction: plan.instruction,
      claimedActual: plan.claimedActual,
      predicate: plan.validate.predicate,
      op: plan.validate.op,
      observed: plan.validate.observed,
      dailyScoresRootsPda: plan.validate.dailyScoresRootsPda,
      accounts: plan.accounts,
    };
  }
  return {
    kind: plan.kind,
    instruction: plan.instruction,
    eventOrdinal: plan.eventOrdinal,
    claimedBucket: plan.claimedBucket,
    never: plan.never,
    seqs: plan.seqs,
    accounts: plan.accounts,
  };
}

main().catch((e) => {
  log.error("fatal", e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
