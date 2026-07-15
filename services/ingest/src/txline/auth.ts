import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import type { RuntimeConfig } from "../config.js";
import { loadTxoracleIdl } from "./idl.js";
import { guestStart, TxlineError } from "./client.js";
import { PRICING_MATRIX_SEED, TOKEN_TREASURY_V2_SEED } from "./networks.js";
import type { TxlineTokens } from "../util/tokens.js";
import { logger } from "../util/log.js";

const log = logger("auth");

/** Minimal shape of the Anchor method builder chain we use (runtime IDL = untyped). */
interface AnchorMethodBuilder {
  accountsPartial(accounts: Record<string, PublicKey>): AnchorMethodBuilder;
  preInstructions(ixs: unknown[]): AnchorMethodBuilder;
  rpc(): Promise<string>;
}

/**
 * Full TxLINE auth flow (README §7.2, spike #1):
 *   1. guest JWT
 *   2. on-chain txoracle.subscribe(serviceLevel, weeks)  (user wallet signs & pays)
 *   3. ed25519-sign `${txSig}::${jwt}`  (empty leagues)
 *   4. POST /api/token/activate → apiToken
 * Returns persisted-shape tokens; the caller decides where to save them.
 */
export async function authenticate(
  cfg: RuntimeConfig,
  wallet: Keypair,
  opts: { leagues?: string[]; airdropIfLow?: boolean } = {},
): Promise<TxlineTokens> {
  const leagues = opts.leagues ?? [];
  const connection = new Connection(cfg.rpcUrl, "confirmed");

  // ── 1. guest JWT ─────────────────────────────────────────────────────────
  const jwt = await guestStart(cfg.network.apiOrigin);
  log.info(`guest JWT acquired (${cfg.network.name})`);

  // ── 2. on-chain subscribe ─────────────────────────────────────────────────
  await ensureFunds(connection, wallet.publicKey, cfg.network.name, opts.airdropIfLow ?? cfg.network.name === "devnet");
  const txSig = await sendSubscribe(cfg, connection, wallet);
  log.info(`subscribe(${cfg.serviceLevel}, ${cfg.subscribeWeeks}) confirmed`, txSig);

  // ── 3. sign the activation message ────────────────────────────────────────
  // `${txSig}:${leagues.join(",")}:${jwt}`  → empty leagues → `${txSig}::${jwt}`
  const message = `${txSig}:${leagues.join(",")}:${jwt}`;
  const sigBytes = nacl.sign.detached(new TextEncoder().encode(message), wallet.secretKey);
  const walletSignature = Buffer.from(sigBytes).toString("base64");

  // ── 4. activate → apiToken ────────────────────────────────────────────────
  const apiToken = await activate(cfg.network.apiOrigin, jwt, {
    txSig,
    walletSignature,
    leagues,
  });
  // Never print credential material, even partially: terminal logs are often
  // copied into CI output, support threads, and demo recordings.
  log.info("apiToken activated");

  return {
    network: cfg.network.name,
    jwt,
    apiToken,
    wallet: wallet.publicKey.toBase58(),
    subscribeTx: txSig,
    serviceLevel: cfg.serviceLevel,
    activatedAt: Date.now(),
  };
}

/** Build and send the txoracle `subscribe` instruction. */
async function sendSubscribe(
  cfg: RuntimeConfig,
  connection: Connection,
  wallet: Keypair,
): Promise<string> {
  const idl = loadTxoracleIdl(cfg.network);
  const provider = new AnchorProvider(connection, new Wallet(wallet), {
    commitment: "confirmed",
  });
  const program = new Program(idl as Idl, provider);
  const programId = cfg.network.txoracleProgramId;

  const [pricingMatrix] = PublicKey.findProgramAddressSync([PRICING_MATRIX_SEED], programId);
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([TOKEN_TREASURY_V2_SEED], programId);

  const txlMint = cfg.network.txlMint;
  const userTokenAccount = getAssociatedTokenAddressSync(
    txlMint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    txlMint,
    tokenTreasuryPda,
    true, // PDA owner is off-curve
    TOKEN_2022_PROGRAM_ID,
  );

  // Free tiers still require the user's TxL ATA to exist (subscribe reads it,
  // even at price 0). Create it idempotently so a fresh wallet works.
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    wallet.publicKey,
    userTokenAccount,
    wallet.publicKey,
    txlMint,
    TOKEN_2022_PROGRAM_ID,
  );

  // Anchor's methods namespace is untyped for a runtime-loaded IDL.
  const methods = program.methods as Record<string, (...a: unknown[]) => AnchorMethodBuilder>;
  const txSig = await methods
    .subscribe!(cfg.serviceLevel, cfg.subscribeWeeks)
    .accountsPartial({
      user: wallet.publicKey,
      pricingMatrix,
      tokenMint: txlMint,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: PublicKey.default,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .preInstructions([ataIx])
    .rpc();

  return txSig;
}

/** POST /api/token/activate → apiToken (text/plain). */
async function activate(
  origin: string,
  jwt: string,
  body: { txSig: string; walletSignature: string; leagues: string[] },
): Promise<string> {
  const res = await fetch(`${origin}/api/token/activate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new TxlineError(`token/activate → ${res.status}: ${text}`, res.status, text);
  }
  // apiToken is returned as text/plain (may be JSON-quoted on some deployments).
  return text.trim().replace(/^"|"$/g, "");
}

/** Ensure the wallet can pay tx fees + ATA rent. Airdrops on devnet. */
async function ensureFunds(
  connection: Connection,
  pubkey: PublicKey,
  network: "devnet" | "mainnet",
  airdrop: boolean,
): Promise<void> {
  const MIN_LAMPORTS = 0.02 * LAMPORTS_PER_SOL; // subscribe fee + TxL ATA rent
  let balance = await connection.getBalance(pubkey);
  if (balance >= MIN_LAMPORTS) {
    log.info(`wallet balance ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL — sufficient`);
    return;
  }
  if (!airdrop || network === "mainnet") {
    throw new Error(
      `Wallet ${pubkey.toBase58()} has ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL on ${network}; ` +
        `needs ≥ ${(MIN_LAMPORTS / LAMPORTS_PER_SOL).toFixed(3)} SOL. ` +
        (network === "mainnet"
          ? "Fund this MAINNET wallet manually (real SOL) before subscribing."
          : "Airdrop failed — retry."),
    );
  }
  for (let attempt = 1; attempt <= 3 && balance < MIN_LAMPORTS; attempt++) {
    log.info(`devnet airdrop attempt ${attempt} → ${pubkey.toBase58()}`);
    try {
      const sig = await connection.requestAirdrop(pubkey, 1 * LAMPORTS_PER_SOL);
      const bh = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    } catch (e) {
      log.warn(`airdrop attempt ${attempt} failed`, (e as Error).message);
    }
    balance = await connection.getBalance(pubkey);
  }
  if (balance < MIN_LAMPORTS) {
    throw new Error(
      `Could not fund devnet wallet after 3 airdrops (balance ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL). ` +
        `Devnet faucet may be rate-limited; try https://faucet.solana.com or retry later.`,
    );
  }
  log.info(`funded: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
}
