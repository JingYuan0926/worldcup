import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NetworkName } from "../txline/networks.js";
import { logger } from "./log.js";

const log = logger("tokens");

/** Persisted TxLINE credentials for one network. */
export interface TxlineTokens {
  network: NetworkName;
  /** guest JWT (Authorization: Bearer). 30-day expiry — re-auth on 401. */
  jwt: string;
  /** apiToken (X-Api-Token). Issued by /api/token/activate after subscribe. */
  apiToken: string;
  /** base58 wallet that signed the subscribe tx. */
  wallet: string;
  /** subscribe tx signature, for provenance. */
  subscribeTx: string;
  /** service level subscribed. */
  serviceLevel: number;
  /** unix ms when persisted. */
  activatedAt: number;
}

function tokenPath(dir: string, network: NetworkName): string {
  return resolve(dir, `${network}.json`);
}

export function saveTokens(dir: string, tokens: TxlineTokens): void {
  const abs = tokenPath(dir, tokens.network);
  mkdirSync(resolve(dir), { recursive: true });
  writeFileSync(abs, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  log.info(`saved ${tokens.network} tokens → ${abs}`);
}

export function loadTokens(dir: string, network: NetworkName): TxlineTokens | null {
  const abs = tokenPath(dir, network);
  if (!existsSync(abs)) return null;
  return JSON.parse(readFileSync(abs, "utf8")) as TxlineTokens;
}
