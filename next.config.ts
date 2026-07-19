import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The shared payout package ships raw TypeScript (its "main" is ./src/index.ts)
  // and is imported by BetPanel/FlashMarket/SettlementPanel. Next must transpile
  // it from source — without this the /match route fails to compile. (derek's
  // next.config.ts dropped this; local web/next.config.mjs had it for the same pkg.)
  transpilePackages: ["@exact-match/payout"],
};

export default nextConfig;
