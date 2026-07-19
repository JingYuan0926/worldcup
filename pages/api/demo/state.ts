import type { NextApiRequest, NextApiResponse } from "next";
import { readState, DEMO_LOCK_SECONDS } from "@/lib/demo-ops";

/**
 * Which fixture the demo is currently running on.
 *
 * The browser cannot read this from an env var: a reset mints a NEW fixture at
 * runtime, so the id has to be served, not baked in at build time.
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const state = readState();
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    // Fall back to the env namespace so the page still works before any reset.
    fixtureId: state?.fixtureId ?? Number(process.env.NEXT_PUBLIC_FIXTURE_ID ?? 18222447),
    lockTs: state?.lockTs ?? null,
    lockSeconds: DEMO_LOCK_SECONDS,
    fresh: Boolean(state),
  });
}
