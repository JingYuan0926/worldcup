#!/usr/bin/env -S npx tsx
/**
 * Proof round-trip spike (README §7.5/§7.6; spikes #2, #4, #5).
 *
 * Fetches a TxLINE stat-validation Merkle proof for a finished fixture and runs
 * it through the on-chain txoracle `validate_stat` — first via `.view()`
 * (simulated, NO SOL) to read the returned bool, then via a raw
 * `simulateTransaction` to capture compute units and the wire size vs the
 * 1232-byte packet limit.
 *
 *   npm run proof-roundtrip -- --network devnet --fixture 17588310
 *   npm run proof-roundtrip -- --fixture 17588310 --statKey 7 --statKey2 8   # corners P1+P2 == actual
 *   npm run proof-roundtrip -- --fixture 17588310 --seq 480 --statKey 1 --statKey2 2 --threshold 3
 *
 * Answers: does devnet anchor real WC fixtures (spike #2)? CU consumed + tx size
 * (spike #4)? does EqualTo + Add validate a real "a + b == N" (spike #5)?
 *
 * NOTE: with no saved TxLINE token this prints a ready-later message and exits 0
 * (the subscribe tx is currently blocked on funding). Run the auth flow first:
 *   npm run auth -- --network devnet
 */
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { loadConfig } from "../config.js";
import { TxlineClient } from "../txline/client.js";
import {
  buildValidateStatArgs,
  dailyScoresRootsPda,
  epochDayFromTs,
  makeTxoracleProgram,
  normalizeStatValidation,
  Comparison,
  BinaryExpression,
  VALIDATE_STAT_ERROR_HINTS,
  type ValidateStatArgs,
} from "../txline/txoracle.js";
import type { NetworkName } from "../txline/networks.js";
import { logger } from "../util/log.js";

const log = logger("cli:proof");

const PACKET_LIMIT = 1232; // Solana max serialized tx size (README §7.5, spike #4)

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Minimal untyped view of the Anchor method builder (runtime IDL is untyped). */
interface Builder {
  accountsPartial(accounts: Record<string, PublicKey>): Builder;
  preInstructions(ixs: unknown[]): Builder;
  view(): Promise<unknown>;
  instruction(): Promise<TransactionInstruction>;
}

async function main(): Promise<void> {
  const network = (arg("network") ?? process.env.TXLINE_NETWORK ?? "devnet") as NetworkName;
  const fixtureId = Number(arg("fixture") ?? "17588310"); // Tunisia–Japan, finished (README §7.7)
  const statKey = Number(arg("statKey") ?? "7"); // corners P1 by default
  const statKey2Raw = arg("statKey2");
  const statKey2 = statKey2Raw !== undefined ? Number(statKey2Raw) : undefined;
  const seqArg = arg("seq");
  const thresholdArg = arg("threshold");

  const cfg = loadConfig(network);

  // ── token gate ────────────────────────────────────────────────────────────
  let client: TxlineClient;
  try {
    client = TxlineClient.fromSaved(cfg.tokensDir, network);
  } catch {
    log.warn(
      `No saved TxLINE token for ${network} — cannot fetch a live proof yet ` +
        `(subscribe tx is blocked on funding). This spike is ready to run once you have one.`,
    );
    log.info(`Run first:  npm run auth -- --network ${network}`);
    process.exit(0);
  }

  log.info(
    `proof round-trip on ${network}: fixture ${fixtureId}, statKey ${statKey}` +
      (statKey2 !== undefined ? ` + statKey2 ${statKey2} (Add)` : "") +
      ` → txoracle ${cfg.network.txoracleProgramId.toBase58()}`,
  );

  // ── 1. resolve the settlement seq ───────────────────────────────────────────
  let seq: number;
  if (seqArg !== undefined) {
    seq = Number(seqArg);
  } else {
    log.info(`no --seq: discovering a late seq via /api/scores/historical/${fixtureId}`);
    const hist = await client.getJson<unknown>(`/api/scores/historical/${fixtureId}`);
    const discovered = latestSeq(hist);
    if (discovered === undefined) {
      throw new Error(
        `could not discover a seq from /api/scores/historical/${fixtureId} ` +
          `(historical only serves fixtures started 6h–2w ago). Pass --seq explicitly.`,
      );
    }
    seq = discovered;
    log.info(`discovered latest seq = ${seq}`);
  }

  // ── 2. fetch the stat-validation proof ──────────────────────────────────────
  const params = new URLSearchParams({
    fixtureId: String(fixtureId),
    seq: String(seq),
    statKey: String(statKey),
  });
  if (statKey2 !== undefined) params.set("statKey2", String(statKey2));
  const proofPath = `/api/scores/stat-validation?${params.toString()}`;
  log.info(`GET ${proofPath}`);
  const payload = await client.getJson<unknown>(proofPath);

  // ── 3. build validate_stat args (EqualTo, +Add when statKey2 given) ─────────
  const norm = normalizeStatValidation(payload);
  const actual =
    norm.stat_a.stat_to_prove.value + (norm.stat_b ? norm.stat_b.stat_to_prove.value : 0);
  const threshold = thresholdArg !== undefined ? Number(thresholdArg) : actual;
  if (thresholdArg === undefined) {
    log.info(`no --threshold: defaulting to observed actual = ${actual} (EqualTo should hold)`);
  }
  const op = statKey2 !== undefined ? BinaryExpression.Add : null;
  const args: ValidateStatArgs = buildValidateStatArgs(norm, {
    predicate: { threshold, comparison: Comparison.EqualTo },
    op,
  });

  // ── 4. derive the daily_scores_merkle_roots PDA (README §7.6) ────────────────
  const epochDay = epochDayFromTs(norm.summary.update_stats.min_timestamp);
  const pda = dailyScoresRootsPda(cfg.network, epochDay);
  log.info(`epochDay ${epochDay} → daily_scores_merkle_roots PDA ${pda.toBase58()}`);

  // ── 5. wire up the program + method builder ─────────────────────────────────
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const program = makeTxoracleProgram(connection, cfg.network); // throwaway wallet: view/simulate only
  const methods = program.methods as unknown as Record<string, (...a: unknown[]) => Builder>;
  const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

  const builder = methods
    .validateStat!(...args)
    .accountsPartial({ dailyScoresMerkleRoots: pda })
    .preInstructions([cuIx]);

  // ── 6. .view() — simulated, returns the bool (spikes #2 & #5) ────────────────
  let returned: boolean | undefined;
  try {
    const result = await builder.view();
    returned = result === true;
    log.info(`✅ validate_stat.view() returned: ${String(result)}`);
  } catch (e) {
    reportTxoracleError("view()", e);
  }

  // ── 7. raw simulateTransaction — CU + tx size (spike #4) ─────────────────────
  try {
    const ix = await methods
      .validateStat!(...args)
      .accountsPartial({ dailyScoresMerkleRoots: pda })
      .instruction();

    const payer = (program.provider as AnchorProvider).wallet.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    const msg = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [cuIx, ix],
    }).compileToV0Message();
    const vtx = new VersionedTransaction(msg);

    const txBytes = vtx.serialize().length;
    const sim = await connection.simulateTransaction(vtx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    });
    const cu = sim.value.unitsConsumed;

    log.info(
      `📏 tx size ${txBytes}/${PACKET_LIMIT} bytes` +
        (txBytes > PACKET_LIMIT ? "  ⚠️ OVER LIMIT — split or use validate_stat_v2" : "  ✓ fits"),
    );
    log.info(`⚡ compute units consumed: ${cu ?? "unknown"} / 1,400,000 requested`);
    if (sim.value.err) {
      log.warn(`simulate err: ${JSON.stringify(sim.value.err)}`);
      reportTxoracleError("simulateTransaction", { logs: sim.value.logs ?? [] });
    }
  } catch (e) {
    reportTxoracleError("simulateTransaction", e);
  }

  // ── summary ─────────────────────────────────────────────────────────────────
  log.info("── spike results ─────────────────────────────");
  log.info(`fixture ${fixtureId} seq ${seq} statKey ${statKey}${statKey2 !== undefined ? "+" + statKey2 : ""}`);
  log.info(`predicate: (a${statKey2 !== undefined ? " + b" : ""}) EqualTo ${threshold}`);
  log.info(`validate_stat returned: ${returned === undefined ? "ERROR (see above)" : returned}`);
  log.info(
    statKey2 !== undefined
      ? `EqualTo + Add path (spike #5): ${returned ? "CONFIRMED ✅" : "did not validate — inspect above"}`
      : `single-stat EqualTo path: ${returned ? "CONFIRMED ✅" : "did not validate — inspect above"}`,
  );
}

/** Find the largest `seq` in a /api/scores/historical response (shape-tolerant). */
function latestSeq(hist: unknown): number | undefined {
  const arr = Array.isArray(hist)
    ? hist
    : ((hist as { records?: unknown[]; data?: unknown[]; scores?: unknown[] })?.records ??
        (hist as { data?: unknown[] })?.data ??
        (hist as { scores?: unknown[] })?.scores);
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  let max = -Infinity;
  for (const r of arr) {
    const rec = r as Record<string, unknown>;
    const raw = rec["seq"] ?? rec["Seq"] ?? rec["sequence"];
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > max) max = n;
  }
  return Number.isFinite(max) ? max : undefined;
  // TODO(live-proof): confirm the historical record field is `seq` (README §7.3
  // calls it the per-fixture settlement cursor) against a real response.
}

/** Print the matching txoracle error hint (README §7.5) for a failed call. */
function reportTxoracleError(where: string, e: unknown): void {
  const code = findErrorCode(e);
  const msg = e instanceof Error ? e.message : String(e);
  if (code !== undefined && VALIDATE_STAT_ERROR_HINTS[code]) {
    log.error(`${where} → txoracle error ${code}: ${VALIDATE_STAT_ERROR_HINTS[code]}`);
  } else {
    log.error(`${where} failed`, msg.slice(0, 300));
  }
}

/** Extract a txoracle custom error code from an Anchor/simulation error. */
function findErrorCode(e: unknown): number | undefined {
  const anyE = e as { error?: { errorCode?: { number?: number } }; logs?: string[]; message?: string };
  if (typeof anyE?.error?.errorCode?.number === "number") return anyE.error.errorCode.number;
  const text = [anyE?.message ?? "", ...(anyE?.logs ?? [])].join("\n");
  const dec = text.match(/Error Number:\s*(\d+)/);
  if (dec?.[1]) return Number(dec[1]);
  const hex = text.match(/custom program error:\s*0x([0-9a-fA-F]+)/i);
  if (hex?.[1]) return parseInt(hex[1], 16);
  return undefined;
}

main().catch((e) => {
  log.error("fatal", e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
