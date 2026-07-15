import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Keypair } from "@solana/web3.js";
import { logger } from "./log.js";

const log = logger("wallet");

/**
 * Load a Solana keypair from a JSON file (array of 64 bytes, `solana-keygen`
 * format). If it does not exist, generate one and persist it (0600). Devnet
 * wallets can be freely regenerated; a mainnet wallet must be funded manually.
 */
export function loadOrCreateKeypair(keypairPath: string): Keypair {
  const abs = resolve(keypairPath);
  if (existsSync(abs)) {
    const raw = JSON.parse(readFileSync(abs, "utf8")) as number[];
    const kp = Keypair.fromSecretKey(Uint8Array.from(raw));
    log.info(`loaded keypair ${kp.publicKey.toBase58()} from ${keypairPath}`);
    return kp;
  }
  const kp = Keypair.generate();
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  log.warn(`generated NEW keypair ${kp.publicKey.toBase58()} → ${keypairPath}`);
  return kp;
}
