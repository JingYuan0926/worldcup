#!/usr/bin/env -S npx tsx
/**
 * SSE recorder CLI (spike #9). Captures raw scores (+optionally odds) frames
 * for a fixture to recordings/<network>/<fixtureId>/.
 *
 *   npm run record -- --fixture 18209181 --network mainnet --odds
 *   npm run record -- --fixture 18209181            # devnet, scores only
 *
 * Runs until Ctrl-C; auto-reconnects with Last-Event-ID; resumable across
 * process restarts via the per-stream .cursor file.
 */
import { loadConfig } from "../config.js";
import { TxlineClient } from "../txline/client.js";
import { RecorderSession } from "../record.js";
import type { NetworkName } from "../txline/networks.js";
import { logger } from "../util/log.js";

const log = logger("cli:record");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const network = (arg("network") ?? process.env.TXLINE_NETWORK ?? "devnet") as NetworkName;
  const fixtureId = Number(arg("fixture") ?? process.env.WC_QF_FIXTURE_ID);
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
    throw new Error("--fixture <id> is required (or set WC_QF_FIXTURE_ID)");
  }

  const cfg = loadConfig(network);
  const client = TxlineClient.fromSaved(cfg.tokensDir, network);

  const session = new RecorderSession(client, {
    fixtureId,
    recordOdds: flag("odds"),
    outBaseDir: cfg.recordingsDir,
  });

  let stopping = false;
  const shutdown = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`${sig} received — flushing recordings…`);
    await session.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  session.start();
  log.info("recorder live. Ctrl-C to stop. (irreplaceable data — keep it running through the match)");
}

main().catch((e) => {
  log.error("fatal", e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
