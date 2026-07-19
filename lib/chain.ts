import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idl from "@/lib/idl/exact_match.json";
import { FIXTURE } from "@/lib/demo";

/** Deployed on devnet — see program/programs/exact-match/src/lib.rs. */
export const PROGRAM_ID = new PublicKey(idl.address);

export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

/**
 * The on-chain namespace for this demo's pools.
 *
 * Pool PDAs are seeded by (fixture_id, pool_index) and can only be created once,
 * so anything that changes the Pool layout or the escrow asset needs a fresh id —
 * the SOL-era pools at 18222446 would still decode under the new IDL and render as
 * garbage. The timeline data is unchanged; only the namespace moves.
 * `FIXTURE_ID` is read too so the CLIs and the browser can agree.
 */
export const FIXTURE_ID = Number(
  process.env.NEXT_PUBLIC_FIXTURE_ID ?? process.env.FIXTURE_ID ?? FIXTURE.fixtureId,
);

/**
 * The escrow asset — our 6-decimal demo USDC mint (see `npm run usdc:create`).
 * Each pool records its own mint on-chain, so this is only the default the client
 * derives ATAs from; pointing it at a different mint needs no program change.
 */
export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ?? "H39LvFdH7Ra1ZbnW9hNxxqfFgZiRfTw2ATff4iGcVHS5",
);
export const USDC_DECIMALS = 6;
const USDC_UNIT = 10 ** USDC_DECIMALS;

export const toUsdc = (n: number | bigint) => Number(n) / USDC_UNIT;
export const usdcToBase = (n: number) => Math.round(n * USDC_UNIT);

/** The pool's vault is an ATA owned by the pool PDA. */
export function vaultAta(pool: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(USDC_MINT, pool, true, TOKEN_PROGRAM_ID);
}

export function userAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(USDC_MINT, owner, false, TOKEN_PROGRAM_ID);
}

export function connection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

/* -------------------------------------------------------------------- PDAs */

function fixtureSeed(fixtureId: number): Buffer {
  return new BN(fixtureId).toArrayLike(Buffer, "le", 8);
}

/** `fixtureId` is runtime state (see /api/demo/state) — never assume the default. */
export function poolPda(poolIndex: number, fixtureId: number = FIXTURE_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), fixtureSeed(fixtureId), Buffer.from([poolIndex])],
    PROGRAM_ID,
  )[0];
}

/* ------------------------------------------------------------------ program */

/** Minimal wallet shape — satisfied by both wallet-adapter and a raw Keypair signer. */
export interface AnchorWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

export function getProgram(wallet: AnchorWallet | null): Program {
  const provider = new AnchorProvider(
    connection(),
    // Reads (fetching pools, crowd histogram) must work with no wallet attached,
    // so a null wallet gets a stub that throws only if something tries to sign.
    (wallet ?? {
      publicKey: PublicKey.default,
      signTransaction: () => Promise.reject(new Error("wallet not connected")),
      signAllTransactions: () => Promise.reject(new Error("wallet not connected")),
    }) as AnchorWallet,
    { commitment: "confirmed" },
  );
  return new Program(idl as Idl, provider);
}

/* -------------------------------------------------------------------- state */

export interface OnChainEntry {
  wallet: string;
  guess: number;
  stake: number;
  claimed: boolean;
}

export interface OnChainPool {
  poolIndex: number;
  address: string;
  lockTs: number;
  settleDeadlineTs: number;
  sliderMin: number;
  sliderMax: number;
  /** 0 Open, 1 Settled, 2 Refunding */
  state: number;
  actual: number;
  totalStaked: number;
  entries: OnChainEntry[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function decodePool(poolIndex: number, address: PublicKey, raw: any): OnChainPool {
  return {
    poolIndex,
    address: address.toBase58(),
    lockTs: Number(raw.lockTs),
    settleDeadlineTs: Number(raw.settleDeadlineTs),
    sliderMin: raw.sliderMin,
    sliderMax: raw.sliderMax,
    state: raw.state,
    actual: raw.actual,
    totalStaked: Number(raw.totalStaked),
    entries: (raw.entries ?? []).map((e: any) => ({
      wallet: e.wallet.toBase58(),
      guess: e.guess,
      stake: Number(e.stake),
      claimed: e.claimed,
    })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Fetch several pools at once. A missing pool is `null` rather than an error:
 * pools are created permissionlessly, so "not bootstrapped yet" is a normal state
 * the UI has to render, not a failure.
 */
export async function fetchPools(
  program: Program,
  poolIndexes: number[],
  fixtureId: number = FIXTURE_ID,
): Promise<(OnChainPool | null)[]> {
  const addrs = poolIndexes.map((i) => poolPda(i, fixtureId));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raws = await (program.account as any).pool.fetchMultiple(addrs);
  return raws.map((raw: unknown, i: number) =>
    raw ? decodePool(poolIndexes[i]!, addrs[i]!, raw) : null,
  );
}

/* ---------------------------------------------------------------- mutations */

/**
 * One `enter` per pool, batched into a single transaction so the user signs once.
 * Solana caps a transaction at 1232 bytes; each enter is small, and a lane only
 * offers a handful of pools, so the realistic ceiling here is well inside that.
 */
export async function buildEnterTx(
  program: Program,
  user: PublicKey,
  calls: { poolIndex: number; bucket: number; stakeBase: number }[],
  fixtureId: number = FIXTURE_ID,
): Promise<Transaction> {
  const ixs = await Promise.all(
    calls.map((c) => {
      const pool = poolPda(c.poolIndex, fixtureId);
      return program.methods
        .enter(c.bucket, new BN(c.stakeBase))
        .accounts({
          user,
          pool,
          mint: USDC_MINT,
          vault: vaultAta(pool),
          userToken: userAta(user),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
    }),
  );

  const tx = new (await import("@solana/web3.js")).Transaction();
  tx.add(...ixs);
  return tx;
}

export async function buildClaimTx(
  program: Program,
  user: PublicKey,
  poolIndexes: number[],
  fixtureId: number = FIXTURE_ID,
): Promise<Transaction> {
  const ixs = await Promise.all(
    poolIndexes.map((i) => {
      const pool = poolPda(i, fixtureId);
      return program.methods
        .claim()
        .accounts({
          user,
          pool,
          mint: USDC_MINT,
          vault: vaultAta(pool),
          userToken: userAta(user),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
    }),
  );
  const tx = new (await import("@solana/web3.js")).Transaction();
  tx.add(...ixs);
  return tx;
}

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export function explorerAddress(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}
