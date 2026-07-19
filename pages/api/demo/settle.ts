import type { NextApiRequest, NextApiResponse } from "next";
import { settleDemo } from "@/lib/demo-ops";

/**
 * Post the real outcomes, derived from the recorded TxLINE feed.
 *
 * This is the resolver-signed step the `validate_stat` CPI eventually replaces —
 * same numbers, but proven on-chain rather than asserted here.
 */
export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  try {
    const out = await settleDemo();
    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e).split("\n")[0] });
  }
}
