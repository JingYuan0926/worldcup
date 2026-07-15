import type { NetworkName, TxlineNetwork } from "./networks.js";
import { getNetwork } from "./networks.js";
import { loadTokens, type TxlineTokens } from "../util/tokens.js";
import { logger } from "../util/log.js";

const log = logger("txline");

export class TxlineError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "TxlineError";
  }
}

/**
 * Authenticated TxLINE REST client. Every data request carries BOTH headers
 * (README gotcha #1): `Authorization: Bearer <jwt>` AND `X-Api-Token: <token>`.
 */
export class TxlineClient {
  readonly network: TxlineNetwork;
  private jwt: string;
  private readonly apiToken: string;

  constructor(network: TxlineNetwork, jwt: string, apiToken: string) {
    this.network = network;
    this.jwt = jwt;
    this.apiToken = apiToken;
  }

  /** Build a client from persisted tokens (written by the auth module). */
  static fromSaved(dir: string, networkName: NetworkName): TxlineClient {
    const tokens = loadTokens(dir, networkName);
    if (!tokens) {
      throw new Error(
        `No saved TxLINE tokens for ${networkName} in ${dir}. Run: npm run auth -- --network ${networkName}`,
      );
    }
    return TxlineClient.fromTokens(tokens);
  }

  static fromTokens(tokens: TxlineTokens): TxlineClient {
    return new TxlineClient(getNetwork(tokens.network), tokens.jwt, tokens.apiToken);
  }

  /** Data headers (both required). Exposed so the SSE reader can reuse them. */
  dataHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.jwt}`,
      "X-Api-Token": this.apiToken,
      ...extra,
    };
  }

  get origin(): string {
    return this.network.apiOrigin;
  }

  /** Refresh the guest JWT in place (30-day expiry; re-auth on 401). */
  async refreshJwt(): Promise<void> {
    this.jwt = await guestStart(this.network.apiOrigin);
    log.info(`refreshed guest JWT for ${this.network.name}`);
  }

  private async request(path: string, init?: RequestInit, retryOn401 = true): Promise<Response> {
    const url = path.startsWith("http") ? path : `${this.network.apiOrigin}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: { ...this.dataHeaders(), ...(init?.headers as Record<string, string>) },
    });
    if (res.status === 401 && retryOn401) {
      await this.refreshJwt();
      return this.request(path, init, false);
    }
    return res;
  }

  async getJson<T>(path: string): Promise<T> {
    const res = await this.request(path);
    const body = await res.text();
    if (!res.ok) {
      throw new TxlineError(`GET ${path} → ${res.status}`, res.status, body);
    }
    return JSON.parse(body) as T;
  }

  async getText(path: string): Promise<string> {
    const res = await this.request(path);
    const body = await res.text();
    if (!res.ok) throw new TxlineError(`GET ${path} → ${res.status}`, res.status, body);
    return body;
  }
}

/** Step 1 of the auth flow: fetch a guest JWT (no body). README §7.2. */
export async function guestStart(origin: string): Promise<string> {
  const res = await fetch(`${origin}/auth/guest/start`, { method: "POST" });
  if (!res.ok) {
    throw new TxlineError(`guest/start → ${res.status}`, res.status, await res.text());
  }
  const json = (await res.json()) as { token: string };
  return json.token;
}
