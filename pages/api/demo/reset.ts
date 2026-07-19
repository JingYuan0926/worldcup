import type { NextApiRequest, NextApiResponse } from "next";
import { resetDemo } from "@/lib/demo-ops";

/**
 * Rebuild the room: fresh fixture, six pools, the seeded crowd, and the operator's
 * calls. 20–40s of devnet round-trips, so the client must show progress.
 *
 * Serialised with a module-level flag: two resets at once would race on the state
 * file and half-fill two fixtures.
 */
let running = false;

export const config = { maxDuration: 120 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  if (running) return res.status(409).json({ ok: false, error: "A reset is already running." });

  running = true;
  try {
    const log = await resetDemo();
    return res.status(200).json({ ok: true, ...log });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e).split("\n")[0] });
  } finally {
    running = false;
  }
}
