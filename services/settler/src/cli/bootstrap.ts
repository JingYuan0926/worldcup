#!/usr/bin/env -S npx tsx
/**
 * Pool bootstrapper CLI (README §5.1, §6; TASKS Phase 2).
 *
 *   npm run bootstrap -- --fixture 18209181 --network devnet
 *
 * Prints the curated pool set it WOULD create for a fixture — one `create_pool`
 * per §5.1 template (total goals, total corners, first-half goals, window of the
 * 1st goal, window of the 1st yellow) with every on-chain parameter resolved:
 * `fixture_id`, `pool_index`, stat spec, `lock_ts` (= kickoff StartTime),
 * `settle_phase`, `settle_deadline_ts` (= lock_ts + 12h) and the slider range.
 *
 * `create_pool` is a program instruction (permissionless, no admin key) that is
 * DEPLOY-GATED — the `exact_match` program is built last — so this describes the
 * plan rather than sending it. With a saved token it reads the real StartTime
 * from `/api/fixtures/snapshot`; without one it prints the plan using a clearly
 * labelled placeholder kickoff (and never fails).
 */
import { loadConfig } from "../../../ingest/src/config.js";
import type { NetworkName } from "../../../ingest/src/txline/networks.js";
import { logger } from "../../../ingest/src/util/log.js";
import { POOL_TEMPLATES, phaseName, type PoolTemplate } from "../phase.js";
import { authHint, fetchFixture, loadSettlerClient } from "../proofs.js";
import { exactMatchProgramId, poolPda, poolVault } from "../settle.js";

const log = logger("cli:bootstrap");

/** Documented placeholder kickoff when no token/snapshot is available. */
const PLACEHOLDER_KICKOFF_MS = Date.parse("2026-07-14T19:00:00Z"); // a WC semifinal slot
const SETTLE_DEADLINE_MS = 12 * 60 * 60 * 1000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface CreatePoolPlan {
  instruction: "create_pool";
  fixtureId: number;
  poolIndex: number;
  label: string;
  kind: string;
  statSpec: { statKeyA: number; statKeyB: number | null; op: string | null };
  lockTs: number;
  lockTsIso: string;
  settlePhase: number;
  settlePhaseName: string;
  settleDeadlineTs: number;
  sliderMin: number;
  sliderMax: number;
  eventOrdinal: number | null;
  poolPda: string | null;
  vault: string | null;
  poolSeeds: string;
}

function planFor(
  t: PoolTemplate,
  fixtureId: number,
  lockTsMs: number,
  usdtMint: import("@solana/web3.js").PublicKey,
): CreatePoolPlan {
  const programId = exactMatchProgramId();
  const pda = programId ? poolPda(programId, fixtureId, t.poolIndex) : null;
  return {
    instruction: "create_pool",
    fixtureId,
    poolIndex: t.poolIndex,
    label: t.label,
    kind: t.kind,
    statSpec: {
      statKeyA: t.spec.statKeyA,
      statKeyB: t.spec.statKeyB ?? null,
      op: t.spec.statKeyB !== undefined ? (t.spec.op ?? "add") : null,
    },
    lockTs: lockTsMs,
    lockTsIso: new Date(lockTsMs).toISOString(),
    settlePhase: t.settlePhase,
    settlePhaseName: phaseName(t.settlePhase),
    settleDeadlineTs: lockTsMs + SETTLE_DEADLINE_MS,
    sliderMin: t.sliderMin,
    sliderMax: t.sliderMax,
    eventOrdinal: t.eventOrdinal ?? null,
    poolPda: pda ? pda.toBase58() : null,
    vault: pda ? poolVault(pda, usdtMint).toBase58() : null,
    poolSeeds: `["pool", i64_le(${fixtureId}), u8(${t.poolIndex})]`,
  };
}

async function main(): Promise<void> {
  const network = (arg("network") ?? process.env.TXLINE_NETWORK ?? "devnet") as NetworkName;
  const fixtureArg = arg("fixture");
  if (!fixtureArg) {
    log.error("missing --fixture <id>. e.g. npm run bootstrap -- --fixture 18209181 --network devnet");
    process.exit(1);
  }
  const fixtureId = Number(fixtureArg);
  const cfg = loadConfig(network);

  // Resolve kickoff (StartTime). Token optional — fall back to a placeholder.
  let lockTsMs = arg("lock-ts") !== undefined ? Number(arg("lock-ts")) : PLACEHOLDER_KICKOFF_MS;
  let kickoffSource = arg("lock-ts") !== undefined ? "--lock-ts override" : "PLACEHOLDER (no token/snapshot)";
  let matchLabel = `fixture ${fixtureId}`;

  const client = loadSettlerClient(cfg.tokensDir, network);
  if (!client) {
    log.warn(authHint(network));
    log.info("Printing the create_pool plan with a placeholder kickoff — authenticate to resolve the real StartTime.");
  } else if (arg("lock-ts") === undefined) {
    const fx = await fetchFixture(client, fixtureId).catch(() => undefined);
    if (fx) {
      lockTsMs = fx.startTimeMs;
      kickoffSource = "/api/fixtures/snapshot StartTime";
      matchLabel = `${fx.participant1 ?? "?"} v ${fx.participant2 ?? "?"} (fixture ${fixtureId})`;
    } else {
      log.warn(`fixture ${fixtureId} not in the upcoming snapshot (knockout ids appear only after the prior round) — using placeholder kickoff.`);
    }
  }

  const programId = exactMatchProgramId();
  log.info(`bootstrap ${matchLabel} on ${network}`);
  log.info(`kickoff (lock_ts) = ${new Date(lockTsMs).toISOString()} [${kickoffSource}]`);
  log.info(
    programId
      ? `exact_match program: ${programId.toBase58()} — pool PDAs derived below`
      : "exact_match program: NOT deployed (set EXACT_MATCH_PROGRAM_ID once it is) — showing seeds instead of PDAs",
  );
  log.info(`create_pool is permissionless (no admin key) and DEPLOY-GATED; this is the plan of ${POOL_TEMPLATES.length} pools:`);

  const plans = POOL_TEMPLATES.map((t) => planFor(t, fixtureId, lockTsMs, cfg.network.usdtMint));
  for (const p of plans) {
    const stat = p.statSpec.statKeyB
      ? `k${p.statSpec.statKeyA} ${p.statSpec.op} k${p.statSpec.statKeyB}`
      : `k${p.statSpec.statKeyA}`;
    log.info(
      `  pool ${p.poolIndex} [${p.kind.toUpperCase()}] "${p.label}": stat (${stat}), ` +
        `range ${p.sliderMin}..${p.sliderMax}, settle @ ${p.settlePhaseName}(${p.settlePhase})` +
        (p.eventOrdinal ? `, event #${p.eventOrdinal}` : "") +
        (p.poolPda ? `, PDA ${p.poolPda}` : `, seeds ${p.poolSeeds}`),
    );
  }

  // eslint-disable-next-line no-console
  console.log("\n" + JSON.stringify({ fixtureId, network, kickoffSource, lockTsMs, pools: plans }, null, 2) + "\n");
  log.info(
    "TODO(program): once exact_match is deployed, submit each as " +
      "exactMatchProgram.methods.createPool(...params).accounts({ pool, usdtMint, ... }).rpc()",
  );
}

main().catch((e) => {
  log.error("fatal", e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
