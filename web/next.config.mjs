/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The payout package is shared TS source from the monorepo; transpile it.
  transpilePackages: ["@exact-match/payout"],
};

export default nextConfig;
