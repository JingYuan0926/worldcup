import { PublicKey } from "@solana/web3.js";

/**
 * TxLINE network configuration. Verified against README §7.1 (2026-07-09).
 *
 * NEVER mix networks: a devnet `subscribe` tx must be activated on `txline-dev`,
 * mainnet on `txline`. The app runs on devnet (service level 1, free, real-time);
 * the live recorder uses mainnet level 12 (free, real-time).
 */
export type NetworkName = "devnet" | "mainnet";

export interface TxlineNetwork {
  readonly name: NetworkName;
  /** REST + SSE origin. */
  readonly apiOrigin: string;
  /** Solana RPC endpoint (overridable via env). */
  readonly defaultRpc: string;
  /** txoracle program deployed on this cluster. */
  readonly txoracleProgramId: PublicKey;
  /** TxL subscription-credit mint (Token-2022). */
  readonly txlMint: PublicKey;
  /** Devnet USDT escrow mint (Token-2022). */
  readonly usdtMint: PublicKey;
  /** Free real-time service level to subscribe to (README §7.2). */
  readonly defaultServiceLevel: number;
  /** Solana cluster moniker for anchor/CLI. */
  readonly cluster: "devnet" | "mainnet-beta";
}

const DEVNET: TxlineNetwork = {
  name: "devnet",
  apiOrigin: "https://txline-dev.txodds.com",
  defaultRpc: "https://api.devnet.solana.com",
  txoracleProgramId: new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"),
  txlMint: new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG"),
  usdtMint: new PublicKey("ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh"),
  defaultServiceLevel: 1,
  cluster: "devnet",
};

const MAINNET: TxlineNetwork = {
  name: "mainnet",
  apiOrigin: "https://txline.txodds.com",
  defaultRpc: "https://api.mainnet-beta.solana.com",
  txoracleProgramId: new PublicKey("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA"),
  txlMint: new PublicKey("Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL"),
  usdtMint: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
  // README §7.2: mainnet level 12 = same coverage as level 1 but REAL-TIME and free.
  defaultServiceLevel: 12,
  cluster: "mainnet-beta",
};

export const NETWORKS: Record<NetworkName, TxlineNetwork> = {
  devnet: DEVNET,
  mainnet: MAINNET,
};

export function getNetwork(name: string): TxlineNetwork {
  if (name !== "devnet" && name !== "mainnet") {
    throw new Error(`Unknown TXLINE_NETWORK "${name}" (expected "devnet" | "mainnet")`);
  }
  return NETWORKS[name];
}

/** PDA seeds used by the txoracle `subscribe` instruction (README §7.2). */
export const PRICING_MATRIX_SEED = Buffer.from("pricing_matrix");
export const TOKEN_TREASURY_V2_SEED = Buffer.from("token_treasury_v2");
