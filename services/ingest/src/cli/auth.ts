#!/usr/bin/env -S npx tsx
/**
 * TxLINE auth CLI (spike #1).
 *   npm run auth -- --network devnet     # full flow, persists .tokens/devnet.json
 *   npm run auth -- --network mainnet     # requires a funded mainnet wallet
 *   npm run auth -- --network devnet --verify   # just re-check saved tokens
 */
import { loadConfig } from "../config.js";
import { authenticate } from "../txline/auth.js";
import { TxlineClient } from "../txline/client.js";
import { loadOrCreateKeypair } from "../util/wallet.js";
import { saveTokens } from "../util/tokens.js";
import type { NetworkName } from "../txline/networks.js";
import { logger } from "../util/log.js";

const log = logger("cli:auth");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const network = (arg("network") ?? process.env.TXLINE_NETWORK ?? "devnet") as NetworkName;
  const cfg = loadConfig(network);

  if (flag("verify")) {
    const client = TxlineClient.fromSaved(cfg.tokensDir, network);
    await smokeTest(client, network);
    return;
  }

  log.info(`authenticating on ${network} (level ${cfg.serviceLevel}, ${cfg.subscribeWeeks}w)`);
  const wallet = loadOrCreateKeypair(cfg.keypairPath);
  const tokens = await authenticate(cfg, wallet);
  saveTokens(cfg.tokensDir, tokens);

  const client = TxlineClient.fromTokens(tokens);
  await smokeTest(client, network);
  log.info("✅ auth complete");
}

/** Confirm the apiToken works and probe whether this network carries the QF. */
async function smokeTest(client: TxlineClient, network: NetworkName): Promise<void> {
  const epochDay = Math.floor(Date.now() / 86_400_000);
  log.info(`smoke test: /api/fixtures/snapshot?startEpochDay=${epochDay}`);
  try {
    const fixtures = await client.getJson<unknown[]>(
      `/api/fixtures/snapshot?startEpochDay=${epochDay}`,
    );
    log.info(`fixtures snapshot OK — ${fixtures.length} fixtures for epochDay ${epochDay}`);
    const qf = (fixtures as Array<{ FixtureId?: number }>).find(
      (f) => f.FixtureId === 18209181,
    );
    log.info(
      qf
        ? `🎯 QF 18209181 (France–Morocco) IS present on ${network} — recordable here`
        : `QF 18209181 not in today's snapshot on ${network} (may need a different epochDay or network)`,
      qf,
    );
  } catch (e) {
    log.error("smoke test failed", (e as Error).message);
    throw e;
  }
}

main().catch((e) => {
  log.error("fatal", e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
