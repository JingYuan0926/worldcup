import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  createAssociatedTokenAccountIdempotent,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

/**
 * Test-USDC faucet.
 *
 * This runs server-side for one reason: minting requires the mint authority's
 * secret key, and a secret shipped to the browser is not a secret. The page at
 * /mint only ever POSTs an address here.
 *
 * It is a faucet, so it is deliberately open — anyone who can reach it can mint
 * play money. That is fine for a devnet demo and fine only there: the authority
 * key doubles as the pools' `resolver`, so this file must never be deployed
 * anywhere its RPC points at a cluster where that key holds anything real.
 */

const RPC = process.env.SOLANA_DEVNET_RPC ?? "https://api.devnet.solana.com";
const MINT = new PublicKey(
  process.env.USDC_MINT ??
    process.env.NEXT_PUBLIC_USDC_MINT ??
    "H39LvFdH7Ra1ZbnW9hNxxqfFgZiRfTw2ATff4iGcVHS5",
);

/** Per-request cap — enough to bet with, not enough to distort a demo pot. */
const MAX_AMOUNT = 1000;
const DEFAULT_AMOUNT = 500;

function authority(): Keypair {
  const file = path.join(process.cwd(), "keypairs", "devnet.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))));
}

type Data =
  | { ok: true; signature: string; balance: string; mint: string }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  const { address, amount } = req.body ?? {};

  let owner: PublicKey;
  try {
    owner = new PublicKey(String(address ?? "").trim());
  } catch {
    return res.status(400).json({ ok: false, error: "That is not a valid Solana address." });
  }

  const want = Number(amount ?? DEFAULT_AMOUNT);
  if (!Number.isFinite(want) || want <= 0) {
    return res.status(400).json({ ok: false, error: "Amount must be a positive number." });
  }
  if (want > MAX_AMOUNT) {
    return res.status(400).json({ ok: false, error: `Max ${MAX_AMOUNT} USDC per request.` });
  }

  try {
    const connection = new Connection(RPC, "confirmed");
    const auth = authority();

    // The authority pays the ATA rent, so a brand-new wallet with zero SOL can
    // still receive test USDC and start betting.
    const ata = await createAssociatedTokenAccountIdempotent(
      connection,
      auth,
      MINT,
      owner,
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID,
    );

    const signature = await mintTo(
      connection,
      auth,
      MINT,
      ata,
      auth,
      BigInt(Math.round(want * 1e6)),
      [],
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID,
    );

    const balance = await connection.getTokenAccountBalance(ata);
    return res.status(200).json({
      ok: true,
      signature,
      balance: balance.value.uiAmountString ?? "0",
      mint: MINT.toBase58(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg.split("\n")[0]! });
  }
}
