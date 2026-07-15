/**
 * TxLINE settlement data access — the read side of the crank.
 *
 * Fetches everything the settle builders need from the TxLINE REST surface:
 *   - `stat-validation` Merkle proofs (COUNT: one proof; WHEN: two bracketing
 *     proofs, or one terminal proof for NEVER),
 *   - the Scores record sequence used to pick the settle `seq` / detect phase,
 *   - a fixture's `StartTime` (kickoff = pool `lock_ts`).
 *
 * All hashes are decoded and every payload is normalised through the shared
 * `normalizeStatValidation` so the proof shape matches the on-chain
 * `validate_stat` structs exactly (README §7.5, docs/settlement-spec.md §1).
 *
 * Token gate: {@link loadSettlerClient} returns `null` when no TxLINE tokens are
 * saved (subscribe currently blocked on funding). Every consumer must handle
 * null and print the `npm run auth` hint — there is no live data without a token.
 */
import type { NetworkName } from "../../ingest/src/txline/networks.js";
import { loadTokens } from "../../ingest/src/util/tokens.js";
import { TxlineClient } from "../../ingest/src/txline/client.js";
import { normalizeStatValidation, type NormalizedProof } from "../../ingest/src/txline/txoracle.js";
import type { StatSpec, PhaseRecord } from "./phase.js";
import { BEYOND_BUCKET, coerceStatusSoccerId, NEVER_BUCKET } from "./phase.js";
import { logger } from "../../ingest/src/util/log.js";

const log = logger("settler:proofs");

/**
 * Build a TxLINE client from saved tokens, or `null` if none exist. Centralises
 * the missing-token gate so every CLI/crank prints the same hint and exits 0.
 */
export function loadSettlerClient(tokensDir: string, network: NetworkName): TxlineClient | null {
  const tokens = loadTokens(tokensDir, network);
  if (!tokens) return null;
  return TxlineClient.fromTokens(tokens);
}

/** The auth hint printed whenever the token is missing. */
export function authHint(network: NetworkName): string {
  return `No saved TxLINE token for ${network} — run:  npm run auth -- --network ${network}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// stat-validation proofs
// ─────────────────────────────────────────────────────────────────────────────

export interface ProofQuery {
  fixtureId: number;
  seq: number;
  /** Full stat key (period-encoded, README §7.4), e.g. 7 (corners P1), 1001. */
  statKey: number;
  /** Second key for two-key pools (corners P2 = 8, goals P2 = 2/1002). */
  statKey2?: number;
}

/** GET the stat-validation URL for a query (both `statKey`/`statKey2` legacy mode). */
export function statValidationPath(q: ProofQuery): string {
  const p = new URLSearchParams({
    fixtureId: String(q.fixtureId),
    seq: String(q.seq),
    statKey: String(q.statKey),
  });
  if (q.statKey2 !== undefined) p.set("statKey2", String(q.statKey2));
  return `/api/scores/stat-validation?${p.toString()}`;
}

/**
 * Fetch + normalise a single stat-validation proof (README §7.3/§7.5). The
 * returned {@link NormalizedProof} carries `stat_a` (and `stat_b` for two-key
 * queries) with 32-byte-decoded hashes, ready for `buildValidateStatArgs`.
 */
export async function fetchStatValidation(
  client: TxlineClient,
  q: ProofQuery,
): Promise<NormalizedProof> {
  const path = statValidationPath(q);
  log.info(`GET ${path}`);
  const payload = await client.getJson<unknown>(path);
  return normalizeStatValidation(payload);
}

/** Cumulative stat value of a proof (`stat_a` + `stat_b` when present). */
export function proofStatValue(proof: NormalizedProof): number {
  return proof.stat_a.stat_to_prove.value + (proof.stat_b?.stat_to_prove.value ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// WHEN pools — two bracketing proofs (docs/settlement-spec.md §3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The two bracketing proofs (+ derived bucket) for a WHEN pool's Nth event, or
 * the single terminal proof when the event NEVER happened.
 */
export interface BracketProofs {
  /** N — the event ordinal being bracketed (1 = first goal, …). */
  eventOrdinal: number;
  /** Proof A: `stat == N-1` on a batch strictly BEFORE the crossing window. */
  proofA?: NormalizedProof;
  /** Proof B: `stat >= N` on the batch INSIDE the crossing window. */
  proofB?: NormalizedProof;
  /** Single terminal proof: `stat <= N-1` at the final batch → NEVER. */
  neverProof?: NormalizedProof;
  /** Kickoff-relative 5-min bucket of the crossing (from proof B), or NEVER. */
  bucket: number;
}

/**
 * Which `seq`s bracket the Nth crossing. Derived from a per-`seq` cumulative
 * stat series (see {@link recordsToSeqStats}).
 *
 * Selection (docs/settlement-spec.md §3):
 *  - `insideSeq` = the FIRST seq whose cumulative stat `>= N` (the batch the
 *    count crossed into N — this is proof B, and its batch window → the bucket).
 *  - `beforeSeq` = the LAST seq before `insideSeq` whose cumulative stat is
 *    exactly `N-1` (proof A, a batch that ends strictly before the crossing).
 *  - If no seq reaches N by the terminal record → NEVER (`terminalSeq`).
 */
export interface WhenSeqSelection {
  eventOrdinal: number;
  beforeSeq?: number;
  insideSeq?: number;
  /** Present only for the NEVER case: the terminal-phase seq. */
  terminalSeq?: number;
}

/** A `seq` with its cumulative stat value and batch window (WHEN scratch data). */
export interface SeqStat {
  seq: number;
  status: number;
  cumulativeStat: number;
  minTimestamp?: number;
}

/**
 * Pick the bracketing `seq`s for the Nth crossing from a cumulative series.
 * Pure + deterministic so it is unit-testable without the network.
 */
export function pickWhenSeqs(series: readonly SeqStat[], eventOrdinal: number): WhenSeqSelection {
  const sorted = [...series].sort((a, b) => a.seq - b.seq);
  const inside = sorted.find((s) => s.cumulativeStat >= eventOrdinal);
  if (!inside) {
    const terminal = sorted[sorted.length - 1];
    return { eventOrdinal, ...(terminal ? { terminalSeq: terminal.seq } : {}) };
  }
  // last seq strictly before the crossing with value exactly N-1
  let before: SeqStat | undefined;
  for (const s of sorted) {
    if (s.seq >= inside.seq) break;
    if (s.cumulativeStat === eventOrdinal - 1) before = s;
  }
  return {
    eventOrdinal,
    ...(before ? { beforeSeq: before.seq } : {}),
    insideSeq: inside.seq,
  };
}

/**
 * Kickoff-relative 5-minute bucket of a batch window (docs/settlement-spec.md
 * §3.1): `floor((batch_min_timestamp_ms - lock_ts_ms) / 300_000)`, clamped to
 * the stoppage/beyond bucket (18). PROVISIONAL: the exact regulation↔stoppage
 * boundary depends on real batch timestamps — confirm before freezing.
 */
export function bucketFromTimestamp(minTimestampMs: number, lockTsMs: number): number {
  const raw = Math.floor((minTimestampMs - lockTsMs) / 300_000);
  if (raw < 0) return 0;
  if (raw > BEYOND_BUCKET) return BEYOND_BUCKET; // fold 90'+ / extra time into one bucket
  return raw;
}

/**
 * Fetch the bracketing proofs for a WHEN pool. Given the resolved `seq`s
 * (from {@link pickWhenSeqs}), pulls proof A (before) and proof B (inside), or a
 * single terminal proof for NEVER, and derives the bucket from proof B's batch
 * `min_timestamp` relative to `lockTsMs`.
 *
 * NOTE: proof A/B carry the RAW proof only; the EqualTo / GreaterThan / LessThan
 * predicates are attached later by the settle builder (settle.ts) — this layer
 * just fetches the Merkle data at the right seqs.
 */
export async function fetchBracketingProofs(
  client: TxlineClient,
  fixtureId: number,
  spec: StatSpec,
  sel: WhenSeqSelection,
  lockTsMs: number,
): Promise<BracketProofs> {
  const q = (seq: number): ProofQuery => ({
    fixtureId,
    seq,
    statKey: spec.statKeyA,
    ...(spec.statKeyB !== undefined ? { statKey2: spec.statKeyB } : {}),
  });

  if (sel.terminalSeq !== undefined) {
    const neverProof = await fetchStatValidation(client, q(sel.terminalSeq));
    return { eventOrdinal: sel.eventOrdinal, neverProof, bucket: NEVER_BUCKET };
  }

  if (sel.insideSeq === undefined) {
    throw new Error(`WHEN selection has neither a crossing seq nor a terminal seq: ${JSON.stringify(sel)}`);
  }

  const proofB = await fetchStatValidation(client, q(sel.insideSeq));
  const proofA = sel.beforeSeq !== undefined ? await fetchStatValidation(client, q(sel.beforeSeq)) : undefined;

  const bucket = bucketFromTimestamp(proofB.summary.update_stats.min_timestamp, lockTsMs);
  return {
    eventOrdinal: sel.eventOrdinal,
    ...(proofA ? { proofA } : {}),
    proofB,
    bucket,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scores record sequence (phase detection + WHEN cumulative series)
// ─────────────────────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;
function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Unwrap a scores payload (array, or `{data|records|scores|results:[...]}`). */
function asArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (isRec(payload)) {
    for (const k of ["data", "records", "scores", "results"]) {
      if (Array.isArray(payload[k])) return payload[k] as unknown[];
    }
    return [payload]; // a single record object
  }
  return [];
}

function numField(rec: Rec, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

/**
 * Distil a scores payload into {@link PhaseRecord}s ({seq, status, minTimestamp})
 * for {@link settleSeqFor} / phase detection. Shape-tolerant (README §7.3 record
 * essentials); records without a readable `seq` or `statusSoccerId` are skipped.
 */
export function recordsToPhaseRecords(payload: unknown): PhaseRecord[] {
  const out: PhaseRecord[] = [];
  for (const r of asArray(payload)) {
    if (!isRec(r)) continue;
    const seq = numField(r, "seq", "Seq", "sequence");
    const status = coerceStatusSoccerId(r["statusSoccerId"] ?? r["StatusSoccerId"] ?? r["status"]);
    if (seq === undefined || status === undefined) continue;
    const minTimestamp = numField(r, "ts", "Ts", "timestamp", "minTimestamp");
    out.push({ seq, status, ...(minTimestamp !== undefined ? { minTimestamp } : {}) });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

/**
 * Extract the cumulative value of `spec`'s stat(s) from a Scores record. Tries
 * the `stats` map first (keys are numeric strings, README §7.4 / wire-notes),
 * then falls back to the structured `scoreSoccer` totals. Returns `undefined`
 * when neither is present so the caller can skip that seq.
 *
 * TODO(live-proof): confirm the `stats` map keying and the `scoreSoccer` path
 * against a real record; the fallback below is a best effort for full-game
 * goals/corners/cards and is marked PROVISIONAL.
 */
export function extractCumulativeStat(record: unknown, spec: StatSpec): number | undefined {
  if (!isRec(record)) return undefined;
  const stats = record["stats"];
  const fromMap = (key: number): number | undefined => {
    if (!isRec(stats)) return undefined;
    const v = stats[String(key)] ?? stats[key as unknown as string];
    if (typeof v === "number") return v;
    if (typeof v === "string" && Number.isFinite(Number(v))) return Number(v);
    return undefined;
  };
  const a = fromMap(spec.statKeyA);
  const b = spec.statKeyB !== undefined ? fromMap(spec.statKeyB) : 0;
  if (a !== undefined && b !== undefined) return a + b;
  return undefined; // structured-total fallback intentionally deferred (see TODO)
}

/** Build the WHEN cumulative series ({seq,status,cumulativeStat,minTimestamp}). */
export function recordsToSeqStats(payload: unknown, spec: StatSpec): SeqStat[] {
  const out: SeqStat[] = [];
  for (const r of asArray(payload)) {
    if (!isRec(r)) continue;
    const seq = numField(r, "seq", "Seq", "sequence");
    const status = coerceStatusSoccerId(r["statusSoccerId"] ?? r["StatusSoccerId"] ?? r["status"]);
    const cumulativeStat = extractCumulativeStat(r, spec);
    if (seq === undefined || status === undefined || cumulativeStat === undefined) continue;
    const minTimestamp = numField(r, "ts", "Ts", "timestamp", "minTimestamp");
    out.push({ seq, status, cumulativeStat, ...(minTimestamp !== undefined ? { minTimestamp } : {}) });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

/**
 * Fetch the Scores record sequence for a fixture. Tries `historical` (richest,
 * finished fixtures 6h–2w old — README §7.3) then `snapshot`/`updates`. Returns
 * the raw payload so callers can derive both phase records and cumulative
 * series from one fetch.
 */
export async function fetchScores(client: TxlineClient, fixtureId: number): Promise<unknown> {
  // historical is the full replay; fall back to the live snapshot/updates.
  for (const path of [
    `/api/scores/historical/${fixtureId}`,
    `/api/scores/snapshot/${fixtureId}?asOf=`,
    `/api/scores/updates/${fixtureId}`,
  ]) {
    try {
      const payload = await client.getJson<unknown>(path);
      if (asArray(payload).length > 0) {
        log.info(`scores via ${path} (${asArray(payload).length} record(s))`);
        return payload;
      }
    } catch (e) {
      log.warn(`scores fetch ${path} failed`, (e as Error).message.slice(0, 160));
    }
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture snapshot (kickoff = lock_ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface FixtureInfo {
  fixtureId: number;
  /** Kickoff in unix MILLISECONDS (README §7.3 `StartTime`). */
  startTimeMs: number;
  participant1?: string;
  participant2?: string;
  competitionId?: number;
}

/**
 * Fetch a fixture's `StartTime` (kickoff → pool `lock_ts`) from
 * `/api/fixtures/snapshot`. Returns `undefined` if the fixture is not in the
 * snapshot yet (knockout ids appear only after the prior round — README §7.7).
 */
export async function fetchFixture(
  client: TxlineClient,
  fixtureId: number,
): Promise<FixtureInfo | undefined> {
  const payload = await client.getJson<unknown>(`/api/fixtures/snapshot`);
  for (const f of asArray(payload)) {
    if (!isRec(f)) continue;
    const id = numField(f, "FixtureId", "fixtureId");
    if (id !== fixtureId) continue;
    const startTimeMs = numField(f, "StartTime", "startTime");
    if (startTimeMs === undefined) return undefined;
    return {
      fixtureId,
      startTimeMs,
      participant1: strField(f, "Participant1", "participant1"),
      participant2: strField(f, "Participant2", "participant2"),
      competitionId: numField(f, "CompetitionId", "competitionId"),
    };
  }
  return undefined;
}

function strField(rec: Rec, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v !== "") return v;
  }
  return undefined;
}
