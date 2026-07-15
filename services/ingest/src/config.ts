import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { getNetwork, type NetworkName, type TxlineNetwork } from "./txline/networks.js";

// Load repo-root .env regardless of cwd (services run from various dirs).
// This file is at <root>/services/ingest/src/config.ts → 3 dirs up is <root>.
const REPO_ROOT = resolve(import.meta.dirname, "../../..");
loadDotenv({ path: resolve(REPO_ROOT, ".env") });

function env(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var ${key}`);
  }
  return v;
}

export interface RuntimeConfig {
  readonly network: TxlineNetwork;
  readonly rpcUrl: string;
  readonly keypairPath: string;
  readonly serviceLevel: number;
  readonly subscribeWeeks: number;
  readonly tokensDir: string;
  readonly repoRoot: string;
  readonly recordingsDir: string;
}

/**
 * Resolve runtime config for a given network. `networkOverride` lets a CLI
 * (e.g. the recorder) target mainnet while the app defaults to devnet.
 */
export function loadConfig(networkOverride?: NetworkName): RuntimeConfig {
  const networkName = (networkOverride ?? env("TXLINE_NETWORK", "devnet")) as NetworkName;
  const network = getNetwork(networkName);

  const rpcUrl =
    networkName === "devnet"
      ? env("SOLANA_DEVNET_RPC", network.defaultRpc)
      : env("SOLANA_MAINNET_RPC", network.defaultRpc);

  const keypairPath =
    networkName === "devnet"
      ? env("DEVNET_WALLET_KEYPAIR", "./keypairs/devnet.json")
      : env("MAINNET_WALLET_KEYPAIR", "./keypairs/mainnet.json");

  const serviceLevel = Number(
    networkName === "devnet"
      ? env("DEVNET_SERVICE_LEVEL", String(network.defaultServiceLevel))
      : env("MAINNET_SERVICE_LEVEL", String(network.defaultServiceLevel)),
  );

  return {
    network,
    rpcUrl,
    keypairPath: resolve(REPO_ROOT, keypairPath),
    serviceLevel,
    subscribeWeeks: Number(env("SUBSCRIBE_WEEKS", "4")),
    tokensDir: resolve(REPO_ROOT, env("TXLINE_TOKENS_DIR", "./.tokens")),
    repoRoot: REPO_ROOT,
    recordingsDir: resolve(REPO_ROOT, "recordings"),
  };
}
