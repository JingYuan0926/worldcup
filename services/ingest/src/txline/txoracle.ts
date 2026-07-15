import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, BN, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import type { TxlineNetwork } from "./networks.js";
import { loadTxoracleIdl } from "./idl.js";
import { logger } from "../util/log.js";

const log = logger("txoracle");

/**
 * Reusable, well-typed interface to the on-chain txoracle `validate_stat`
 * instruction (README §7.5/§7.6). Shared by the proof round-trip spike AND the
 * future settler crank.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CRITICAL ENCODING FACT (verified empirically 2026-07-09 against the devnet
 * IDL, program "txoracle" v1.4.2):
 *
 *   Anchor ≥0.30 runs `convertIdlToCamelCase` inside the `Program` constructor,
 *   so the BorshCoder addresses every struct field and enum variant by its
 *   CAMEL-CASE name — even though the on-chain Rust / raw IDL uses snake_case.
 *
 *   Passing snake_case keys does NOT throw: buffer-layout reads `src[property]`,
 *   finds `undefined`, and silently serialises ZERO. A `fixture_id`/`key` of 0
 *   sails through and the proof fails on-chain for the wrong reason (or, worse,
 *   validates a forged stat). We proved this: encoding `{fixture_id:1, ...}`
 *   decoded back to fixtureId=0/key=0, while `{fixtureId:1, ...}` decoded to 1/7.
 *
 *   Therefore every object handed to `program.methods.validateStat(...)` MUST
 *   use camelCase field names and camelCase enum keys (`{equalTo:{}}`,
 *   `{add:{}}`). This module owns that translation: callers work in the
 *   snake_case "domain" shapes below (which mirror the IDL / Rust struct and the
 *   README §7.5 spec), and `buildValidateStatArgs` emits the camelCase wire
 *   objects Anchor actually requires.
 * ────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
// Enum args — these values ARE the Anchor enum objects (camelCase inner key), so
// they can be embedded directly into a predicate / op with no further mapping.
// ─────────────────────────────────────────────────────────────────────────────

export type ComparisonArg =
  | { greaterThan: Record<string, never> }
  | { lessThan: Record<string, never> }
  | { equalTo: Record<string, never> };

export type BinaryExpressionArg =
  | { add: Record<string, never> }
  | { subtract: Record<string, never> };

/** `Comparison` enum (README §7.5) as ready-to-pass Anchor objects. */
export const Comparison = {
  GreaterThan: { greaterThan: {} } as ComparisonArg,
  LessThan: { lessThan: {} } as ComparisonArg,
  EqualTo: { equalTo: {} } as ComparisonArg,
} as const;

/** `BinaryExpression` enum (README §7.5) as ready-to-pass Anchor objects. */
export const BinaryExpression = {
  Add: { add: {} } as BinaryExpressionArg,
  Subtract: { subtract: {} } as BinaryExpressionArg,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Domain types — snake_case, mirroring the txoracle IDL / on-chain Rust structs
// exactly (README §7.5). This is the documented, settler-reusable contract.
// `buildValidateStatArgs` maps these to the camelCase Anchor wire objects.
// ─────────────────────────────────────────────────────────────────────────────

/** `ProofNode = { hash: [u8;32], is_right_sibling: bool }`. */
export interface ProofNode {
  hash: Uint8Array;
  is_right_sibling: boolean;
}

/** `ScoreStat = { key: u32, value: i32, period: i32 }` — the innermost Merkle leaf. */
export interface ScoreStat {
  key: number;
  value: number;
  period: number;
}

/** `StatTerm = { stat_to_prove, event_stat_root: [u8;32], stat_proof: Vec<ProofNode> }`. */
export interface StatTerm {
  stat_to_prove: ScoreStat;
  event_stat_root: Uint8Array;
  stat_proof: ProofNode[];
}

/** `TraderPredicate = { threshold: i32, comparison: Comparison }`. */
export interface TraderPredicate {
  threshold: number;
  comparison: ComparisonArg;
}

/** `ScoresUpdateStats = { update_count: i32, min_timestamp: i64, max_timestamp: i64 }` (ms). */
export interface ScoresUpdateStats {
  update_count: number;
  /** unix ms — well within Number.MAX_SAFE_INTEGER for any realistic fixture. */
  min_timestamp: number;
  max_timestamp: number;
}

/**
 * `ScoresBatchSummary = { fixture_id: i64, update_stats, events_sub_tree_root: [u8;32] }`.
 * NB: the stat-validation API returns this root as `eventStatsSubTreeRoot`; the
 * on-chain field is `events_sub_tree_root` — the rename is handled in normalize.
 */
export interface ScoresBatchSummary {
  fixture_id: number;
  update_stats: ScoresUpdateStats;
  events_sub_tree_root: Uint8Array;
}

/** Fully-parsed, hash-decoded stat-validation payload (domain shape). */
export interface NormalizedProof {
  summary: ScoresBatchSummary;
  fixture_proof: ProofNode[];
  main_tree_proof: ProofNode[];
  stat_a: StatTerm;
  stat_b?: StatTerm;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anchor wire types — camelCase, i64 fields as BN, hashes as number[]. These are
// the exact objects the BorshCoder serialises. Do not hand these out; they exist
// only as the return payload of buildValidateStatArgs.
// ─────────────────────────────────────────────────────────────────────────────

interface WireProofNode {
  hash: number[];
  isRightSibling: boolean;
}
interface WireScoreStat {
  key: number;
  value: number;
  period: number;
}
interface WireStatTerm {
  statToProve: WireScoreStat;
  eventStatRoot: number[];
  statProof: WireProofNode[];
}
interface WireTraderPredicate {
  threshold: number;
  comparison: ComparisonArg;
}
interface WireScoresUpdateStats {
  updateCount: number;
  minTimestamp: BN;
  maxTimestamp: BN;
}
interface WireScoresBatchSummary {
  fixtureId: BN;
  updateStats: WireScoresUpdateStats;
  eventsSubTreeRoot: number[];
}

/**
 * The ORDERED positional args for `validate_stat` (README §7.5), ready to spread
 * into `program.methods.validateStat(...args)`.
 * [ts, fixture_summary, fixture_proof, main_tree_proof, predicate, stat_a, stat_b, op]
 */
export type ValidateStatArgs = readonly [
  BN, // ts: i64 (ms) = summary.update_stats.min_timestamp
  WireScoresBatchSummary, // fixture_summary
  WireProofNode[], // fixture_proof: Vec<ProofNode>
  WireProofNode[], // main_tree_proof: Vec<ProofNode>
  WireTraderPredicate, // predicate
  WireStatTerm, // stat_a
  WireStatTerm | null, // stat_b: Option<StatTerm>
  BinaryExpressionArg | null, // op: Option<BinaryExpression>
];

/** Human hints for the txoracle error codes we expect (README §7.5). */
export const VALIDATE_STAT_ERROR_HINTS: Record<number, string> = {
  6003:
    "InvalidSubTreeProof — the stat snapshot does not belong to the summary " +
    "(check stat_a.event_stat_root / stat_proof against the fixture summary).",
  6004:
    "InvalidMainTreeProof — the summary does not belong to the on-chain root " +
    "(check fixture_proof / main_tree_proof, the epochDay, and the daily_scores_roots PDA).",
  6007:
    "RootNotAvailable — the Merkle root for this 5-min slot is not posted yet " +
    "(pick a later seq, or wait for the oracle to post the root).",
  6013:
    "InvalidTimeSlot — ts is not aligned to a 5-min boundary " +
    "(pass summary.updateStats.minTimestamp verbatim as ts).",
  6021:
    "PredicateFailed — proof verified but threshold/comparison did not hold " +
    "(check --threshold vs the real stat value, and Comparison/op).",
  6023:
    "InvalidStatProof — the stat leaf proof is invalid for the event " +
    "(check statKey / period / value mapping in stat_a/stat_b).",
};

// ─────────────────────────────────────────────────────────────────────────────
// Program factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an Anchor `Program` for the txoracle on `network`. For read-only
 * `.view()` / `simulateTransaction` (no SOL needed) omit `wallet` — a throwaway
 * generated keypair is used as the provider signer.
 */
export function makeTxoracleProgram(
  connection: Connection,
  network: TxlineNetwork,
  wallet?: Wallet,
): Program {
  const provider = new AnchorProvider(connection, wallet ?? new Wallet(Keypair.generate()), {
    commitment: "confirmed",
  });
  const idl = loadTxoracleIdl(network);
  return new Program(idl as Idl, provider);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hash decoding (README §7.5, gotcha #4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decode a proof hash that may be base64, base64url, or 0x-hex (or bare 64-char
 * hex) into EXACTLY 32 bytes. Throws if the result is not 32 bytes — proofs must
 * never be silently truncated/padded.
 */
export function decodeHash32(s: string): Uint8Array {
  const t = s.trim();
  let buf: Buffer;
  if (t.startsWith("0x") || t.startsWith("0X")) {
    buf = Buffer.from(t.slice(2), "hex");
  } else if (/^[0-9a-fA-F]{64}$/.test(t)) {
    // Bare 64 hex chars = 32 bytes. (A 32-byte base64 string is 43–44 chars, so
    // there is no ambiguity with base64 here.)
    buf = Buffer.from(t, "hex");
  } else {
    // base64 or base64url — normalise url-safe chars first.
    buf = Buffer.from(t.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  }
  if (buf.length !== 32) {
    throw new Error(
      `proof hash must decode to 32 bytes, got ${buf.length} from "${t.slice(0, 16)}…" ` +
        `(expected base64 or 0x-hex)`,
    );
  }
  return new Uint8Array(buf);
}

// ─────────────────────────────────────────────────────────────────────────────
// Root PDA derivation (README §7.6)
// ─────────────────────────────────────────────────────────────────────────────

/** `epochDay = floor(minTimestampMs / 86_400_000)` — from the PROOF ts, not wall clock. */
export function epochDayFromTs(minTimestampMs: number): number {
  return Math.floor(minTimestampMs / 86_400_000);
}

/**
 * Derive the `daily_scores_merkle_roots` PDA for an epoch-day:
 *   seeds = ["daily_scores_roots", u16_LE(epochDay)], program = txoracle (README §7.6).
 */
export function dailyScoresRootsPda(network: TxlineNetwork, epochDay: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    network.txoracleProgramId,
  );
  return pda;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defensive payload normalisation
//
// The exact JSON shape of GET /api/scores/stat-validation is not fully
// documented and we have no token yet to capture a live sample, so this parser
// tolerates camelCase/snake_case/PascalCase field-name variants and several
// plausible container shapes. It logs the observed shape and throws loudly on a
// missing REQUIRED field (never silently zero — see the encoding note above).
//
// TODO(live-proof): confirm the field names against a real stat-validation
// response for a finished fixture (e.g. 17588310) and tighten these getters.
// ─────────────────────────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
}

/** First defined value among `keys` on `obj` (any casing variant). */
function pick(obj: unknown, ...keys: string[]): unknown {
  const rec = asRecord(obj);
  if (!rec) return undefined;
  for (const k of keys) if (rec[k] !== undefined && rec[k] !== null) return rec[k];
  return undefined;
}

function numOf(v: unknown, field: string): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  throw new Error(`stat-validation: expected a number for "${field}", got ${JSON.stringify(v)}`);
}

function boolOf(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

/** Coerce a hash from a string, a 32-number array, or a {data:[…]} wrapper. */
function coerceHash(v: unknown, field: string): Uint8Array {
  if (typeof v === "string") return decodeHash32(v);
  if (Array.isArray(v)) {
    const bytes = Uint8Array.from(v as number[]);
    if (bytes.length !== 32) {
      throw new Error(`stat-validation: "${field}" byte array is ${bytes.length}, expected 32`);
    }
    return bytes;
  }
  const rec = asRecord(v);
  if (rec && Array.isArray(rec["data"])) return coerceHash(rec["data"], field);
  throw new Error(`stat-validation: cannot decode hash "${field}" from ${JSON.stringify(v)?.slice(0, 64)}`);
}

function toProofNode(v: unknown, ctx: string): ProofNode {
  return {
    hash: coerceHash(pick(v, "hash", "Hash", "node", "value"), `${ctx}.hash`),
    is_right_sibling: boolOf(pick(v, "isRightSibling", "is_right_sibling", "isRight", "right", "IsRightSibling")),
  };
}

function toProofVec(v: unknown, ctx: string): ProofNode[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error(`stat-validation: "${ctx}" is not an array`);
  return v.map((n, i) => toProofNode(n, `${ctx}[${i}]`));
}

function toStatTerm(v: unknown, ctx: string): StatTerm {
  const statToProve = pick(v, "statToProve", "stat_to_prove", "stat", "scoreStat") ?? v;
  return {
    stat_to_prove: {
      key: numOf(pick(statToProve, "key", "statKey", "Key"), `${ctx}.key`),
      value: numOf(pick(statToProve, "value", "Value"), `${ctx}.value`),
      period: numOf(pick(statToProve, "period", "Period") ?? 0, `${ctx}.period`),
    },
    event_stat_root: coerceHash(
      pick(v, "eventStatRoot", "event_stat_root", "statRoot", "EventStatRoot"),
      `${ctx}.event_stat_root`,
    ),
    stat_proof: toProofVec(pick(v, "statProof", "stat_proof", "proof"), `${ctx}.stat_proof`),
  };
}

/**
 * Parse a raw GET /api/scores/stat-validation response into the snake_case
 * domain {@link NormalizedProof}, decoding every hash to 32 bytes.
 */
export function normalizeStatValidation(proofPayload: unknown): NormalizedProof {
  const root = asRecord(proofPayload);
  if (!root) throw new Error("stat-validation: response is not an object");
  log.info("stat-validation payload shape", { topKeys: Object.keys(root) });

  // The summary may be nested or spread at the top level.
  const summarySrc = pick(root, "fixtureSummary", "fixture_summary", "summary", "batchSummary") ?? root;
  const updateStatsSrc = pick(summarySrc, "updateStats", "update_stats", "UpdateStats") ?? summarySrc;

  const summary: ScoresBatchSummary = {
    fixture_id: numOf(pick(summarySrc, "fixtureId", "fixture_id", "FixtureId"), "summary.fixture_id"),
    update_stats: {
      update_count: numOf(
        pick(updateStatsSrc, "updateCount", "update_count", "UpdateCount") ?? 0,
        "summary.update_stats.update_count",
      ),
      min_timestamp: numOf(
        pick(updateStatsSrc, "minTimestamp", "min_timestamp", "MinTimestamp"),
        "summary.update_stats.min_timestamp",
      ),
      max_timestamp: numOf(
        pick(updateStatsSrc, "maxTimestamp", "max_timestamp", "MaxTimestamp"),
        "summary.update_stats.max_timestamp",
      ),
    },
    // CRITICAL rename: API "eventStatsSubTreeRoot" → on-chain "events_sub_tree_root".
    events_sub_tree_root: coerceHash(
      pick(
        summarySrc,
        "eventStatsSubTreeRoot",
        "eventsSubTreeRoot",
        "events_sub_tree_root",
        "subTreeRoot",
        "EventStatsSubTreeRoot",
      ),
      "summary.events_sub_tree_root",
    ),
  };

  // Stat terms: explicit statA/statB, or positional entries of a `stats` array.
  const statsArr = pick(root, "stats", "statTerms");
  const statAsrc =
    pick(root, "statA", "stat_a", "StatA") ?? (Array.isArray(statsArr) ? statsArr[0] : undefined);
  const statBsrc =
    pick(root, "statB", "stat_b", "StatB") ?? (Array.isArray(statsArr) ? statsArr[1] : undefined);
  if (statAsrc === undefined) {
    throw new Error(
      `stat-validation: could not locate stat_a (looked for statA/stat_a and stats[0]). ` +
        `Payload top-level keys: ${JSON.stringify(Object.keys(root))}`,
    );
  }

  const norm: NormalizedProof = {
    summary,
    fixture_proof: toProofVec(pick(root, "fixtureProof", "fixture_proof", "FixtureProof"), "fixture_proof"),
    main_tree_proof: toProofVec(
      pick(root, "mainTreeProof", "main_tree_proof", "MainTreeProof"),
      "main_tree_proof",
    ),
    stat_a: toStatTerm(statAsrc, "stat_a"),
    ...(statBsrc !== undefined ? { stat_b: toStatTerm(statBsrc, "stat_b") } : {}),
  };

  log.info("normalized stat-validation", {
    fixtureId: norm.summary.fixture_id,
    minTs: norm.summary.update_stats.min_timestamp,
    fixtureProofLen: norm.fixture_proof.length,
    mainTreeProofLen: norm.main_tree_proof.length,
    statAProofLen: norm.stat_a.stat_proof.length,
    statA: norm.stat_a.stat_to_prove,
    statB: norm.stat_b?.stat_to_prove ?? null,
  });
  return norm;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain → Anchor wire mapping (the snake_case → camelCase translation)
// ─────────────────────────────────────────────────────────────────────────────

function toWireProofNode(n: ProofNode): WireProofNode {
  return { hash: Array.from(n.hash), isRightSibling: n.is_right_sibling };
}

function toWireStatTerm(t: StatTerm): WireStatTerm {
  return {
    statToProve: { key: t.stat_to_prove.key, value: t.stat_to_prove.value, period: t.stat_to_prove.period },
    eventStatRoot: Array.from(t.event_stat_root),
    statProof: t.stat_proof.map(toWireProofNode),
  };
}

function toWireSummary(s: ScoresBatchSummary): WireScoresBatchSummary {
  return {
    fixtureId: new BN(s.fixture_id),
    updateStats: {
      updateCount: s.update_stats.update_count,
      minTimestamp: new BN(s.update_stats.min_timestamp),
      maxTimestamp: new BN(s.update_stats.max_timestamp),
    },
    eventsSubTreeRoot: Array.from(s.events_sub_tree_root),
  };
}

function isNormalized(v: unknown): v is NormalizedProof {
  const s = asRecord(v);
  const summary = asRecord(s?.["summary"]);
  return summary !== undefined && summary["events_sub_tree_root"] instanceof Uint8Array;
}

/**
 * Build the ORDERED positional args for `validate_stat` (README §7.5):
 *   [ts, fixture_summary, fixture_proof, main_tree_proof, predicate, stat_a, stat_b, op]
 *
 * `proofPayload` may be a raw stat-validation response (it is normalised here)
 * or an already-{@link NormalizedProof}. `opts.predicate` is required. Pass
 * `opts.op` (e.g. {@link BinaryExpression.Add}) for the 2-stat "a + b == N"
 * mode; `opts.statB` overrides the stat_b from the payload (`null` forces
 * single-stat). All hashes are decoded to 32 bytes and every field is emitted in
 * the camelCase shape Anchor's BorshCoder requires.
 */
export function buildValidateStatArgs(
  proofPayload: unknown,
  opts: { predicate: TraderPredicate; statB?: StatTerm | null; op?: BinaryExpressionArg | null },
): ValidateStatArgs {
  const norm = isNormalized(proofPayload) ? proofPayload : normalizeStatValidation(proofPayload);

  // stat_b: explicit override wins; else use the payload's stat_b; else none.
  const statB: StatTerm | null =
    opts.statB !== undefined ? opts.statB : (norm.stat_b ?? null);
  const op: BinaryExpressionArg | null = opts.op ?? null;

  // Add/Subtract needs two operands; a lone stat_b is ignored by a 1-stat call.
  if (op && !statB) log.warn("op provided but stat_b is absent — Add/Subtract needs two operands");
  if (!op && statB) log.warn("stat_b present but no op — validate_stat will ignore the second stat");

  return [
    new BN(norm.summary.update_stats.min_timestamp), // ts (i64, ms)
    toWireSummary(norm.summary),
    norm.fixture_proof.map(toWireProofNode),
    norm.main_tree_proof.map(toWireProofNode),
    { threshold: opts.predicate.threshold, comparison: opts.predicate.comparison },
    toWireStatTerm(norm.stat_a),
    statB ? toWireStatTerm(statB) : null,
    op,
  ] as const;
}
