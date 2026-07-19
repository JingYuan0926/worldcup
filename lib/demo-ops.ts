/**
 * Server-side demo orchestration: reset → seed → settle.
 *
 * SERVER ONLY. This module reads `keypairs/devnet.json` (the mint authority and
 * pool resolver) and `.env` PRIV_KEY. Importing it from a client component would
 * bundle a secret into the browser — it is used exclusively from `pages/api/demo/*`.
 *
 * ── Why a reset creates a whole new fixture ─────────────────────────────────
 * A settled pool is settled forever, and a pool PDA is seeded by
 * (fixture_id, pool_index) so it can only ever be created once. "Run the demo
 * again" therefore cannot rewind the old pools; it mints a fresh namespace and
 * rebuilds the room inside it. The match on the timeline never changes — only
 * where the pools live on-chain.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AnchorProvider, BN, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import idl from "@/lib/idl/exact_match.json";
import { FLASH_POOL, GOAL_POOLS, NEVER_BUCKET, minutesDrawn } from "@/lib/pools";
import { MATCH_SECONDS } from "@/lib/demo";

const RPC = process.env.SOLANA_DEVNET_RPC ?? "https://api.devnet.solana.com";
const STATE_FILE = () => path.join(process.cwd(), ".demo-state.json");

export const USDC_MINT = new PublicKey(
  process.env.USDC_MINT ??
    process.env.NEXT_PUBLIC_USDC_MINT ??
    "H39LvFdH7Ra1ZbnW9hNxxqfFgZiRfTw2ATff4iGcVHS5",
);

/**
 * How long entries stay open, measured from the START of a reset.
 *
 * Generous on purpose. The reset takes 60–135s depending on whether the demo
 * wallets still hold float, so a tight lock can close before you have had a chance
 * to place anything. The old worry — that a long lock would block the auto-settle,
 * since `settle` needs the lock PASSED — is handled properly now: the settle call
 * retries until the chain lets it through (see lib/useDemo.ts). Timing is no longer
 * a race to be tuned.
 */
export const DEMO_LOCK_SECONDS = 300;

export interface DemoState {
  fixtureId: number;
  lockTs: number;
  createdAt: number;
}

export function readState(): DemoState | null {
  const f = STATE_FILE();
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as DemoState;
  } catch {
    return null;
  }
}

function writeState(s: DemoState) {
  writeFileSync(STATE_FILE(), JSON.stringify(s, null, 2));
}

/* ---------------------------------------------------------------- keys --- */

function resolverKey(): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path.join(process.cwd(), "keypairs", "devnet.json"), "utf8"))),
  );
}

function programFor(kp: Keypair): Program {
  const provider = new AnchorProvider(new Connection(RPC, "confirmed"), new Wallet(kp), {
    commitment: "confirmed",
  });
  return new Program(idl as Idl, provider);
}

const poolPda = (programId: PublicKey, fixtureId: number, poolIndex: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), new BN(fixtureId).toArrayLike(Buffer, "le", 8), Buffer.from([poolIndex])],
    programId,
  )[0];

/* --------------------------------------------------------------- crowd --- */

/**
 * The crowd.
 *
 * Hand-written tables gave six entries per pool, which drew a near-flat histogram
 * — it read as an empty market, not a live one. This generates a book instead:
 * `CROWD_WALLETS` traders per pool, each with their own view and stake size, so
 * every lane shows the lumpy, multi-modal shape a real order book has.
 *
 * Deterministic on purpose (seeded RNG, no Math.random): the same demo twice in a
 * row draws the same histogram, and a shape that changed between takes would make
 * the run unshootable.
 *
 * Capped by the program's own MAX_ENTRIES = 64 per pool.
 */
const CROWD_WALLETS = 28;

/** mulberry32 — small, fast, and stable across runs. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller, so opinions cluster around a view instead of spreading uniformly. */
function gaussian(r: () => number, mean: number, sd: number): number {
  const u = Math.max(1e-9, r());
  const v = r();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Where each pool's crowd thinks the goal lands, and how sure they are.
 * `never` is the share who call NEVER — high for goals that mostly do not come.
 */
const VIEWS: Record<number, { mean: number; sd: number; never: number }> = {
  // Flash pool speaks in MINUTES, not buckets: the crowd guesses somewhere around
  // half an hour drawn, and nobody calls "never" — every match is 0–0 at kickoff.
  [6]: { mean: 34, sd: 16, never: 0 },
  0: { mean: 5, sd: 3.5, never: 0.02 }, // ARG 1st — early-ish, wide
  1: { mean: 10, sd: 4, never: 0.05 }, // ARG 2nd — spread through the match
  2: { mean: 14, sd: 3.5, never: 0.18 }, // ARG 3rd — late, some doubt it comes
  3: { mean: 16, sd: 3, never: 0.45 }, // ARG 4th — most say never
  4: { mean: 9, sd: 5, never: 0.08 }, // SUI 1st — the underdog, opinions all over
  5: { mean: 15, sd: 3.5, never: 0.4 }, // SUI 2nd — most say never
};

/**
 * Share of traders who ignore the consensus and take a flyer anywhere on the clock.
 * Without them the tails are dead flat — a real book always has someone on the
 * 2-minute goal, and those lonely calls are exactly the ones §5.3 pays out biggest.
 */
const CONTRARIAN = 0.18;

/** `[bucket, stakeUsdc]` per pool per wallet, generated once at module load. */
const CROWD: Record<number, [number, number][]> = (() => {
  const out: Record<number, [number, number][]> = {};
  const all = [
    ...GOAL_POOLS.map((gp) => ({ poolIndex: gp.poolIndex, lo: 0, hi: 18 })),
    // The flash pool's answers are minutes, so its crowd spreads across the clock.
    { poolIndex: FLASH_POOL.poolIndex, lo: FLASH_POOL.min, hi: FLASH_POOL.max },
  ];
  for (const gp of all) {
    const { lo, hi } = gp;
    const view = VIEWS[gp.poolIndex]!;
    // Seed off the pool index so each pool has its own stable shape.
    const r = rng(1337 + gp.poolIndex * 7919);
    const rows: [number, number][] = [];
    for (let i = 0; i < CROWD_WALLETS; i++) {
      const roll0 = r();
      const bucket =
        roll0 < view.never
          ? NEVER_BUCKET
          : roll0 < view.never + CONTRARIAN
            ? Math.floor(r() * (hi + 1)) // flyer: anywhere in range
            : Math.max(lo, Math.min(hi, Math.round(gaussian(r, view.mean, view.sd))));
      // Stakes are lumpy the way real ones are: lots of small, a few large.
      const roll = r();
      const stake = roll < 0.55 ? 5 + Math.floor(r() * 15) : roll < 0.9 ? 20 + Math.floor(r() * 30) : 50 + Math.floor(r() * 50);
      rows.push([bucket, stake]);
    }
    out[gp.poolIndex] = rows;
  }
  return out;
})();

const WALLETS = CROWD_WALLETS;

const usdcBase = (n: number) => Math.round(n * 1e6);

/**
 * Devnet's public RPC rate-limits hard. Two rules keep a reset inside it:
 * fan out narrowly, and never make N calls where one batched call will do.
 */
const POOL_CONCURRENCY = 3;

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry 429s with backoff. The public endpoint will throw these under any load. */
async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e);
      if (!/429|Too Many Requests|rate limit/i.test(msg)) throw e;
      await sleep(500 * 2 ** i + Math.floor(Math.random() * 250));
    }
  }
  throw lastErr;
}

/** SPL token account: `amount` is a u64 LE at offset 64. */
function tokenAmount(data: Buffer | undefined): number {
  if (!data || data.length < 72) return 0;
  return Number(data.readBigUInt64LE(64));
}

async function mapLimit<T>(xs: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, xs.length) }, async () => {
    while (i < xs.length) {
      const idx = i++;
      await fn(xs[idx]!);
    }
  });
  await Promise.all(workers);
}

const crowdWallet = (i: number) =>
  Keypair.fromSeed(createHash("sha256").update(`exact-match-demo-wallet-${i}`).digest());

/* --------------------------------------------------------------- reset --- */

export interface ResetLog {
  fixtureId: number;
  lockTs: number;
  steps: string[];
}

/**
 * Build a fresh room: new fixture namespace, six pools, and the seeded crowd.
 * Your wallet is left with no entries — the first call of the demo is yours to place.
 *
 * The crowd's transactions go out concurrently (bounded by `POOL_CONCURRENCY`):
 * 28 wallets × 6 pools sent one at a time is minutes of devnet round-trips, which
 * is not a thing you can do in front of an audience.
 */
export async function resetDemo(): Promise<ResetLog> {
  const connection = new Connection(RPC, "confirmed");
  const resolver = resolverKey();
  const program = programFor(resolver);
  const steps: string[] = [];

  /**
   * Monotonic, never repeating.
   *
   * This used to be minute-derived, which quietly broke the loop: two resets inside
   * the same minute produced the SAME fixture, the pools already existed, creation
   * short-circuited on `getAccountInfo`, and the "new" room was the old one —
   * entries, locks and all. The board would not clear and you could not re-bet.
   * Counting off the last run cannot collide.
   */
  const fixtureId = Math.max(18300000, (readState()?.fixtureId ?? 18300000) + 1);
  const lockTs = Math.floor(Date.now() / 1000) + DEMO_LOCK_SECONDS;

  // ── pools ───────────────────────────────────────────────────────────────
  // The flash pool rides along with the goal pools: same lock, same resolver. Its
  // range is minutes (0–124), not buckets, which is why the program's slider span
  // had to stop being pinned to the bucket vocabulary.
  const templates = [
    ...GOAL_POOLS.map((gp) => ({
      poolIndex: gp.poolIndex,
      statKey: gp.statKey,
      min: 0,
      max: NEVER_BUCKET,
    })),
    { poolIndex: FLASH_POOL.poolIndex, statKey: FLASH_POOL.statKey, min: FLASH_POOL.min, max: FLASH_POOL.max },
  ];

  await mapLimit(templates, POOL_CONCURRENCY, async (gp) => {
    const pool = poolPda(program.programId, fixtureId, gp.poolIndex);
    if (await withRetry(() => connection.getAccountInfo(pool))) return;
    const vault = getAssociatedTokenAddressSync(USDC_MINT, pool, true, TOKEN_PROGRAM_ID);
    await program.methods
      .createPool(
        new BN(fixtureId),
        gp.poolIndex,
        gp.statKey,
        0,
        0,
        new BN(lockTs),
        5,
        gp.min,
        gp.max,
        resolver.publicKey,
      )
      .accounts({
        payer: resolver.publicKey,
        pool,
        mint: USDC_MINT,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });
  steps.push(`created ${templates.length} pools (fixture ${fixtureId})`);

  // ── crowd ───────────────────────────────────────────────────────────────
  const seededPools = [...GOAL_POOLS.map((g) => g.poolIndex), FLASH_POOL.poolIndex];
  const needOf = (w: number) =>
    seededPools.reduce((sum, pi) => sum + (CROWD[pi]?.[w]?.[1] ?? 0), 0);

  // Fees first, in one batched transfer. Only the wallets actually short get topped
  // up, so the second reset onward skips this entirely.
  const crowd = Array.from({ length: WALLETS }, (_, w) => crowdWallet(w));
  const floor = LAMPORTS_PER_SOL * 0.02;

  const solInfos = (
    await Promise.all(
      chunks(crowd, 100).map((c) =>
        withRetry(() => connection.getMultipleAccountsInfo(c.map((k) => k.publicKey))),
      ),
    )
  ).flat();

  const shortOnSol = crowd
    .map((kp, i) => ({ kp, lamports: floor - (solInfos[i]?.lamports ?? 0) }))
    .filter((x) => x.lamports > 0);
  for (const chunk of chunks(shortOnSol, 15)) {
    const tx = new Transaction();
    for (const { kp, lamports } of chunk) {
      tx.add(
        SystemProgram.transfer({ fromPubkey: resolver.publicKey, toPubkey: kp.publicKey, lamports }),
      );
    }
    tx.feePayer = resolver.publicKey;
    tx.recentBlockhash = (await withRetry(() => connection.getLatestBlockhash())).blockhash;
    tx.sign(resolver);
    await withRetry(async () =>
      connection.confirmTransaction(await connection.sendRawTransaction(tx.serialize()), "confirmed"),
    );
  }

  // USDC next. Read every ATA in one batched call, then create + mint for only the
  // wallets that are short, several per transaction. On the second reset onward this
  // whole block is a single read and no writes: the wallets are deterministic and
  // still hold last run's float.
  const atas = crowd.map((kp) =>
    getAssociatedTokenAddressSync(USDC_MINT, kp.publicKey, false, TOKEN_PROGRAM_ID),
  );
  const ataInfos = (
    await Promise.all(
      chunks(atas, 100).map((c) => withRetry(() => connection.getMultipleAccountsInfo(c))),
    )
  ).flat();

  const shortOnUsdc = crowd
    .map((kp, i) => ({
      kp,
      ata: atas[i]!,
      exists: Boolean(ataInfos[i]),
      short: usdcBase(needOf(i)) - tokenAmount(ataInfos[i]?.data),
    }))
    .filter((x) => x.short > 0 || !x.exists);

  for (const chunk of chunks(shortOnUsdc, 5)) {
    const tx = new Transaction();
    for (const { kp, ata, exists, short } of chunk) {
      if (!exists) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            resolver.publicKey,
            ata,
            kp.publicKey,
            USDC_MINT,
            TOKEN_PROGRAM_ID,
          ),
        );
      }
      if (short > 0) {
        tx.add(createMintToInstruction(USDC_MINT, ata, resolver.publicKey, short, [], TOKEN_PROGRAM_ID));
      }
    }
    if (tx.instructions.length === 0) continue;
    tx.feePayer = resolver.publicKey;
    tx.recentBlockhash = (await withRetry(() => connection.getLatestBlockhash())).blockhash;
    tx.sign(resolver);
    await withRetry(async () =>
      connection.confirmTransaction(await connection.sendRawTransaction(tx.serialize()), "confirmed"),
    );
  }

  // The calls themselves — each wallet signs its own, so these cannot be batched
  // into one transaction. Narrow fan-out + backoff keeps the public RPC happy.
  await mapLimit(
    Array.from({ length: WALLETS }, (_, w) => w),
    POOL_CONCURRENCY,
    async (w) => {
      const calls = seededPools.flatMap((pi) => {
        const row = CROWD[pi]?.[w];
        return row ? [{ poolIndex: pi, bucket: row[0], stake: row[1] }] : [];
      });
      await enterAll(crowd[w]!, fixtureId, calls);
    },
  );
  steps.push(`seeded ${WALLETS * seededPools.length} calls from ${WALLETS} wallets`);

  // The operator places nothing. An earlier version pre-placed four calls here,
  // which meant every reset handed you back a board that had already bet for you —
  // there was nothing left to demonstrate. The room is now built empty of YOUR
  // money: the crowd is there, the pools are open, and the first call is yours.

  const state: DemoState = { fixtureId, lockTs, createdAt: Date.now() };
  writeState(state);
  return { fixtureId, lockTs, steps };
}

async function enterAll(
  kp: Keypair,
  fixtureId: number,
  calls: { poolIndex: number; bucket: number; stake: number }[],
) {
  if (calls.length === 0) return;
  const connection = new Connection(RPC, "confirmed");
  const program = programFor(kp);

  const tx = new Transaction();
  for (const c of calls) {
    const pool = poolPda(program.programId, fixtureId, c.poolIndex);
    tx.add(
      await program.methods
        .enter(c.bucket, new BN(usdcBase(c.stake)))
        .accounts({
          user: kp.publicKey,
          pool,
          mint: USDC_MINT,
          vault: getAssociatedTokenAddressSync(USDC_MINT, pool, true, TOKEN_PROGRAM_ID),
          userToken: getAssociatedTokenAddressSync(USDC_MINT, kp.publicKey, false, TOKEN_PROGRAM_ID),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );
  }
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await withRetry(() => connection.getLatestBlockhash())).blockhash;
  tx.sign(kp);
  await withRetry(async () =>
    connection.confirmTransaction(await connection.sendRawTransaction(tx.serialize()), "confirmed"),
  );
}

/* -------------------------------------------------------------- settle --- */

/**
 * Goal seconds per side, walked from `Score.Total.Goals` transitions in the
 * recorded feed. Retractions (VAR) pop the goal back off — which is exactly why
 * this cannot be done by counting `Action == "goal"` frames.
 */
function goalsFromFeed(): { home: number[]; away: number[] } {
  const feed = path.join(process.cwd(), "txline-raw", "18222446", "scores.ndjson");
  const frames = readFileSync(feed, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l).data);

  const out: { home: number[]; away: number[] } = { home: [], away: [] };
  const seen = { home: 0, away: 0 };
  let lastClock = 0;

  for (const f of frames) {
    if (f.Clock?.Seconds != null) lastClock = f.Clock.Seconds;
    if (!f.Score) continue;
    for (const [side, key] of [
      ["home", "Participant1"],
      ["away", "Participant2"],
    ] as const) {
      const total = f.Score[key]?.Total?.Goals ?? 0;
      if (total > seen[side]) {
        for (let i = seen[side]; i < total; i++) out[side].push(f.Clock?.Seconds ?? lastClock);
      } else if (total < seen[side]) {
        for (let i = total; i < seen[side]; i++) out[side].pop();
      }
      seen[side] = total;
    }
  }
  return out;
}

export async function settleDemo(): Promise<{ settled: string[]; skipped: string[] }> {
  const state = readState();
  if (!state) throw new Error("no demo running — reset first");

  const resolver = resolverKey();
  const program = programFor(resolver);
  const connection = new Connection(RPC, "confirmed");
  const goals = goalsFromFeed();

  const settled: string[] = [];
  const skipped: string[] = [];

  // The flash pool's outcome comes from the same derived goals, read as a duration
  // rather than a window: every stretch of the match where the sides were level.
  const timeline = [
    ...goals.home.map((second) => ({ second, side: "home" as const })),
    ...goals.away.map((second) => ({ second, side: "away" as const })),
  ];
  const drawnMinutes = minutesDrawn(timeline, MATCH_SECONDS);

  const targets: { poolIndex: number; label: string; actual: number }[] = [
    ...GOAL_POOLS.map((gp) => {
      const second = goals[gp.side][gp.ordinal - 1];
      return {
        poolIndex: gp.poolIndex,
        label: gp.label,
        // The goal never came → NEVER. A real outcome, not a missing one.
        actual: second === undefined ? NEVER_BUCKET : Math.min(18, Math.floor(second / 300)),
      };
    }),
    { poolIndex: FLASH_POOL.poolIndex, label: FLASH_POOL.label, actual: drawnMinutes },
  ];

  for (const gp of targets) {
    const pda = poolPda(program.programId, state.fixtureId, gp.poolIndex);
    if (!(await connection.getAccountInfo(pda))) {
      skipped.push(`${gp.label}: no pool`);
      continue;
    }
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const pool: any = await (program.account as any).pool.fetch(pda);
    if (pool.state !== 0) {
      skipped.push(`${gp.label}: already settled`);
      continue;
    }

    try {
      await program.methods
        .settle(gp.actual)
        .accounts({ resolver: resolver.publicKey, pool: pda })
        .rpc();
      settled.push(
        gp.poolIndex === FLASH_POOL.poolIndex
          ? `${gp.label} → ${gp.actual} minutes`
          : `${gp.label} → ${gp.actual === NEVER_BUCKET ? "NEVER" : `bucket ${gp.actual}`}`,
      );
    } catch (e) {
      skipped.push(`${gp.label}: ${String(e).split("\n")[0]}`);
    }
  }

  return { settled, skipped };
}
