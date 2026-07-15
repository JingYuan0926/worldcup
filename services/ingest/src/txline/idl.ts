import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Idl } from "@coral-xyz/anchor";
import type { NetworkName, TxlineNetwork } from "./networks.js";

/**
 * Load the txoracle IDL for a network. The on-chain devnet IDL is the source of
 * truth (v1.4.2); the mainnet program does not publish an on-chain IDL account,
 * so we reuse the devnet JSON and override `address` per network — README §7.1
 * confirms `subscribe`/`validate_stat` are byte-identical across networks.
 */
export function loadTxoracleIdl(network: TxlineNetwork): Idl {
  const file = `txoracle.${network.name as NetworkName}.json`;
  const path = resolve(import.meta.dirname, "idl", file);
  const idl = JSON.parse(readFileSync(path, "utf8")) as Idl & { address: string };
  // Ensure the IDL address matches the target program on this cluster.
  idl.address = network.txoracleProgramId.toBase58();
  return idl;
}
