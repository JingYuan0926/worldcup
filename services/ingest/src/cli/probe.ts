#!/usr/bin/env -S npx tsx
/**
 * Wire-format probe CLI (README spikes #7, #8; TASKS Phase 0).
 *
 *   npm run probe -- --network devnet
 *
 * Retires the JSON-shape assumptions the settler/UI lean on by hitting the live
 * TxLINE REST surface and REPORTING (never asserting) what actually comes back:
 *   (a) the World Cup competitionId + fixture record shape        (spike #7)
 *   (b) statusSoccerId JSON shape (string / number / object)      (spike #8)
 *   (c) `stats` map key format ("7" numeric-string vs other)      (spike #8)
 *   (d) proof hash encoding (base64 vs 0x-hex) + decoded length   (spike #8)
 *   (e) odds `Prices` vs `Pct` fields + apparent integer scaling  (spike #8)
 *
 * Every request is wrapped so any 4xx/5xx/network error logs a WARN and the
 * probe keeps going; a clean summary is printed at the end. Paste the findings
 * into docs/wire-notes.md (each "Answer:" line is TBD until this runs).
 *
 * Needs a saved TxLINE token. With none present it prints the auth hint and
 * exits 0 (so it's verifiably correct offline and ready to run post-auth).
 */
import { loadConfig } from "../config.js";
import { TxlineClient, TxlineError } from "../txline/client.js";
import { loadTokens } from "../util/tokens.js";
import type { NetworkName } from "../txline/networks.js";
import { logger } from "../util/log.js";

const log = logger("cli:probe");

// Known World Cup fixtures (README §7.7).
const QF_FIXTURE = 18209181; // France–Morocco (Jul 9 20:00 UTC — not yet finished)
const FINISHED_FIXTURE = 17588310; // Tunisia–Japan (Jun 21 — finished; safe for proofs/scores)

// ── tiny arg parsing (matches auth.ts / record.ts) ──────────────────────────
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// ── generic JSON helpers ────────────────────────────────────────────────────
type Rec = Record<string, unknown>;
function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Run a labelled request; on ANY 4xx/5xx or error log a WARN and return null. */
async function attempt<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TxlineError) {
      log.warn(`${label} → HTTP ${e.status}`, e.body.slice(0, 200));
    } else {
      log.warn(`${label} failed`, (e as Error).message);
    }
    return null;
  }
}

/** Unwrap a fixtures/scores payload to a plain array of records. */
function asArray(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (isRec(payload)) {
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.records)) return payload.records;
    if (Array.isArray(payload.results)) return payload.results;
  }
  return null;
}

function findFixture(payload: unknown, id: number): Rec | null {
  const arr = asArray(payload);
  if (!arr) return null;
  for (const f of arr) {
    if (isRec(f) && Number(f.FixtureId ?? f.fixtureId) === id) return f;
  }
  return null;
}

/** Distinct (CompetitionId → Competition name) pairs — helps discover the WC id. */
function distinctCompetitions(payload: unknown): Array<{ id: unknown; name: unknown; count: number }> {
  const arr = asArray(payload);
  if (!arr) return [];
  const seen = new Map<string, { id: unknown; name: unknown; count: number }>();
  for (const f of arr) {
    if (!isRec(f)) continue;
    const id = f.CompetitionId ?? f.competitionId;
    const name = f.Competition ?? f.competition;
    const key = String(id);
    const prev = seen.get(key);
    if (prev) prev.count++;
    else seen.set(key, { id, name, count: 1 });
  }
  return [...seen.values()].sort((a, b) => b.count - a.count);
}

/** Pull one Scores-like record out of a snapshot/updates/historical payload. */
function pickScoresRecord(payload: unknown): Rec | null {
  const arr = asArray(payload);
  if (arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const el = arr[i];
      if (isRec(el)) return el;
    }
    return null;
  }
  return isRec(payload) ? payload : null;
}

function maxSeq(payload: unknown): number | null {
  const arr = asArray(payload);
  if (!arr) return null;
  let best: number | null = null;
  for (const r of arr) {
    if (isRec(r) && typeof r.seq === "number" && (best === null || r.seq > best)) best = r.seq;
  }
  return best;
}

/** Classify a hash-like string: 0x-hex / bare-hex / base64, and decoded bytes. */
function classifyHash(s: string): { encoding: string; bytes: number } {
  if (/^0x[0-9a-fA-F]+$/.test(s)) return { encoding: "0x-hex", bytes: (s.length - 2) / 2 };
  if (/^[0-9a-fA-F]{64}$/.test(s)) return { encoding: "bare-hex", bytes: 32 };
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return { encoding: /[-_]/.test(s) ? "base64url" : "base64", bytes: Buffer.from(b64, "base64").length };
}

/** Recursively collect 32-byte-looking hash strings (unknown field names). */
function collectHashes(
  obj: unknown,
  path = "",
  out: Array<{ path: string; value: string }> = [],
): Array<{ path: string; value: string }> {
  if (typeof obj === "string") {
    if (
      /^0x[0-9a-fA-F]{64}$/.test(obj) ||
      /^[0-9a-fA-F]{64}$/.test(obj) ||
      /^[A-Za-z0-9+/_-]{42,44}={0,2}$/.test(obj)
    ) {
      out.push({ path: path || "(root)", value: obj });
    }
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => collectHashes(v, `${path}[${i}]`, out));
    return out;
  }
  if (isRec(obj)) {
    for (const [k, v] of Object.entries(obj)) collectHashes(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

/** Recursively collect numeric leaves whose key matches /price|pct|odds/i. */
function collectOddsSamples(
  obj: unknown,
  re: RegExp,
  path = "",
  out: Array<{ path: string; key: string; value: number }> = [],
  depth = 0,
): Array<{ path: string; key: string; value: number }> {
  if (depth > 8 || out.length >= 40) return out;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => collectOddsSamples(v, re, `${path}[${i}]`, out, depth + 1));
    return out;
  }
  if (isRec(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (typeof v === "number" && re.test(k)) out.push({ path: p, key: k, value: v });
      else collectOddsSamples(v, re, p, out, depth + 1);
    }
  }
  return out;
}

// ── findings accumulator (printed as the closing summary) ────────────────────
interface Findings {
  competitionId: string;
  statusSoccerIdShape: string;
  statsKeyFormat: string;
  proofHashEncoding: string;
  oddsScaling: string;
}
const NA = "not determined (see WARN above)";

async function main(): Promise<void> {
  const network = (arg("network") ?? process.env.TXLINE_NETWORK ?? "devnet") as NetworkName;
  const cfg = loadConfig(network);

  // ── missing-token guard: correct + ready-to-run-later, exits 0 ─────────────
  const tokens = loadTokens(cfg.tokensDir, network);
  if (!tokens) {
    log.warn(`No saved TxLINE tokens for ${network} in ${cfg.tokensDir}.`);
    log.info(`Authenticate first, then re-run this probe:`);
    log.info(`    npm run auth  -- --network ${network}`);
    log.info(`    npm run probe -- --network ${network}`);
    process.exit(0);
  }
  const client = TxlineClient.fromTokens(tokens);
  log.info(`probing ${network} (${client.origin}) — WARNs are non-fatal, summary prints at end`);

  const findings: Findings = {
    competitionId: NA,
    statusSoccerIdShape: NA,
    statsKeyFormat: NA,
    proofHashEncoding: NA,
    oddsScaling: NA,
  };

  // ══ (a) World Cup competitionId + fixture record shape (spike #7) ══════════
  log.info("── (a) competitionId + fixture shape ──────────────────────────────");
  const startEpochDay = Math.floor(Date.now() / 86_400_000);
  const unfiltered = await attempt("GET /api/fixtures/snapshot", () =>
    client.getJson<unknown>(`/api/fixtures/snapshot`),
  );
  const byDay = await attempt(`GET /api/fixtures/snapshot?startEpochDay=${startEpochDay}`, () =>
    client.getJson<unknown>(`/api/fixtures/snapshot?startEpochDay=${startEpochDay}`),
  );

  const fixture = findFixture(unfiltered, QF_FIXTURE) ?? findFixture(byDay, QF_FIXTURE);
  const comps = distinctCompetitions(unfiltered ?? byDay);
  if (comps.length) {
    log.info(`distinct competitions in snapshot (id → name, count):`);
    for (const c of comps.slice(0, 15)) {
      log.info(`    ${String(c.id).padEnd(10)} ${String(c.name).padEnd(30)} ×${c.count}`);
    }
  }
  if (fixture) {
    const compId = fixture.CompetitionId ?? fixture.competitionId;
    findings.competitionId = `${String(compId)} (from fixture ${QF_FIXTURE} "${String(
      fixture.Competition ?? fixture.competition,
    )}")`;
    log.info(`✅ fixture ${QF_FIXTURE} found — CompetitionId = ${String(compId)}`);
    log.info(`   record keys: ${Object.keys(fixture).join(", ")}`);
    log.info(`   full record:`, JSON.stringify(fixture));
  } else {
    log.warn(
      `fixture ${QF_FIXTURE} not in snapshot yet (knockout ids appear only after the prior round). ` +
        `Pick the WC id from the competitions list above.`,
    );
    if (comps.length) {
      findings.competitionId = `QF fixture absent; candidate competitions: ${comps
        .slice(0, 6)
        .map((c) => `${String(c.id)}=${String(c.name)}`)
        .join(" | ")}`;
    }
  }

  // ══ (b) statusSoccerId shape + (c) stats key format (spike #8) ═════════════
  log.info("── (b/c) statusSoccerId shape + stats keys (finished fixture) ──────");
  let scores = await attempt(`GET /api/scores/snapshot/${FINISHED_FIXTURE}?asOf=`, () =>
    client.getJson<unknown>(`/api/scores/snapshot/${FINISHED_FIXTURE}?asOf=`),
  );
  if (!pickScoresRecord(scores)) {
    scores = await attempt(`GET /api/scores/updates/${FINISHED_FIXTURE}`, () =>
      client.getJson<unknown>(`/api/scores/updates/${FINISHED_FIXTURE}`),
    );
  }
  // historical is the richest source; also gives us a settlement seq for (d).
  const historical = await attempt(`GET /api/scores/historical/${FINISHED_FIXTURE}`, () =>
    client.getJson<unknown>(`/api/scores/historical/${FINISHED_FIXTURE}`),
  );
  if (!pickScoresRecord(scores)) scores = historical;

  const rec = pickScoresRecord(scores);
  if (rec) {
    log.info(`Scores record top-level keys: ${Object.keys(rec).join(", ")}`);

    // (b) statusSoccerId
    const status = rec.statusSoccerId;
    if (status === undefined) {
      findings.statusSoccerIdShape = "field 'statusSoccerId' absent on record — check key casing above";
      log.warn(findings.statusSoccerIdShape);
    } else if (isRec(status)) {
      findings.statusSoccerIdShape = `object — keys: {${Object.keys(status).join(", ")}}`;
      log.info(`statusSoccerId is an OBJECT`, JSON.stringify(status));
    } else {
      findings.statusSoccerIdShape = `${typeof status} — sample value: ${JSON.stringify(status)}`;
      log.info(`statusSoccerId is a ${typeof status} = ${JSON.stringify(status)}`);
    }

    // (c) stats map key format
    const stats = rec.stats;
    if (isRec(stats)) {
      const keys = Object.keys(stats);
      const allNumeric = keys.every((k) => /^-?\d+$/.test(k));
      findings.statsKeyFormat =
        `JSON object; keys are strings (JSON), ${allNumeric ? "all numeric-string like \"7\"" : "MIXED / non-numeric"}. ` +
        `${keys.length} keys, sample: ${keys.slice(0, 8).join(", ")}`;
      log.info(`stats is an object with ${keys.length} keys; numeric-string=${allNumeric}`);
      log.info(`   sample entries:`, JSON.stringify(Object.fromEntries(keys.slice(0, 8).map((k) => [k, stats[k]]))));
    } else if (Array.isArray(stats)) {
      findings.statsKeyFormat = `stats is an ARRAY (not a keyed map) — len ${stats.length}; sample: ${JSON.stringify(
        stats.slice(0, 3),
      )}`;
      log.info(findings.statsKeyFormat);
    } else {
      findings.statsKeyFormat = `no 'stats' field on record (keys: ${Object.keys(rec).join(", ")})`;
      log.warn(findings.statsKeyFormat);
    }
  } else {
    log.warn(`no Scores record obtained for ${FINISHED_FIXTURE} (all score endpoints returned nothing usable)`);
  }

  // ══ (d) proof hash encoding (spike #8) ═════════════════════════════════════
  log.info("── (d) proof hash encoding (stat-validation) ──────────────────────");
  const seq = maxSeq(historical) ?? maxSeq(scores);
  if (seq === null) {
    log.warn(`could not discover a settlement seq (historical unavailable); skipping proof probe`);
  } else {
    log.info(`using late seq=${seq} for fixture ${FINISHED_FIXTURE} (statKey=7 corners P1, statKey2=8 corners P2)`);
    const proof = await attempt(
      `GET /api/scores/stat-validation?fixtureId=${FINISHED_FIXTURE}&seq=${seq}&statKey=7&statKey2=8`,
      () =>
        client.getJson<unknown>(
          `/api/scores/stat-validation?fixtureId=${FINISHED_FIXTURE}&seq=${seq}&statKey=7&statKey2=8`,
        ),
    );
    if (proof) {
      log.info(`stat-validation top-level keys: ${isRec(proof) ? Object.keys(proof).join(", ") : typeof proof}`);
      const hashes = collectHashes(proof);
      if (hashes.length) {
        const seenEnc = new Set<string>();
        const seenLen = new Set<number>();
        for (const h of hashes.slice(0, 12)) {
          const c = classifyHash(h.value);
          seenEnc.add(c.encoding);
          seenLen.add(c.bytes);
          log.info(`    ${h.path.padEnd(40)} ${c.encoding} ${c.bytes}B  ${h.value.slice(0, 24)}…`);
        }
        findings.proofHashEncoding = `encoding(s): ${[...seenEnc].join("/")}; decoded byte length(s): ${[
          ...seenLen,
        ].join("/")} (expect 32). ${hashes.length} hash-like fields found.`;
        log.info(findings.proofHashEncoding);
      } else {
        findings.proofHashEncoding = `no 32-byte hash-like strings found; dump: ${JSON.stringify(proof).slice(0, 300)}`;
        log.warn(findings.proofHashEncoding);
      }
    }
  }

  // ══ (e) odds Prices scaling (spike #8) ═════════════════════════════════════
  log.info("── (e) odds Prices vs Pct scaling ─────────────────────────────────");
  const odds = await attempt(`GET /api/odds/snapshot/${FINISHED_FIXTURE}`, () =>
    client.getJson<unknown>(`/api/odds/snapshot/${FINISHED_FIXTURE}`),
  );
  if (odds) {
    const prices = collectOddsSamples(odds, /price/i);
    const pcts = collectOddsSamples(odds, /pct|percent/i);
    if (prices.length) {
      log.info(`Price-like fields (path=value):`);
      for (const p of prices.slice(0, 10)) log.info(`    ${p.path} = ${p.value}`);
    }
    if (pcts.length) {
      log.info(`Pct-like fields (path=value):`);
      for (const p of pcts.slice(0, 10)) log.info(`    ${p.path} = ${p.value}`);
    }
    const priceVals = prices.map((p) => p.value).filter((v) => v > 0);
    const pctVals = pcts.map((p) => p.value).filter((v) => v > 0);
    const priceMax = priceVals.length ? Math.max(...priceVals) : 0;
    const pctMax = pctVals.length ? Math.max(...pctVals) : 0;
    const priceGuess =
      priceMax === 0
        ? "no Price fields found"
        : priceMax > 100000
          ? "Prices look ×1e6-scaled (implied prob/decimal)"
          : priceMax > 1000
            ? "Prices look ×1000-scaled"
            : priceMax > 100
              ? "Prices look ×100-scaled (or basis points)"
              : "Prices look near-unscaled";
    const pctGuess = pctMax === 0 ? "no Pct fields" : pctMax > 100 ? "Pct in basis points (0–10000)" : "Pct in 0–100";
    findings.oddsScaling = `${priceGuess}; ${pctGuess}. keys seen: ${[
      ...new Set([...prices, ...pcts].map((p) => p.key)),
    ]
      .slice(0, 8)
      .join(", ")} (top-level odds keys: ${isRec(odds) ? Object.keys(odds).join(", ") : typeof odds})`;
    log.info(findings.oddsScaling);
  }

  // ══ closing summary ════════════════════════════════════════════════════════
  const line = "─".repeat(72);
  const summary = [
    "",
    line,
    "  WIRE-FORMAT PROBE SUMMARY  (paste answers into docs/wire-notes.md)",
    line,
    `  (a) WC competitionId    : ${findings.competitionId}`,
    `  (b) statusSoccerId shape: ${findings.statusSoccerIdShape}`,
    `  (c) stats key format    : ${findings.statsKeyFormat}`,
    `  (d) proof hash encoding : ${findings.proofHashEncoding}`,
    `  (e) odds Prices scaling : ${findings.oddsScaling}`,
    line,
    "",
  ].join("\n");
  // Plain console for easy copy-paste (bypasses the timestamped logger prefix).
  // eslint-disable-next-line no-console
  console.log(summary);
  log.info("probe complete");
}

main().catch((e) => {
  log.error("fatal", e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
