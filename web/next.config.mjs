/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep production builds away from the live dev cache. Running `next build`
  // while `next dev` was active previously mixed both outputs and left missing
  // CSS and vendor chunks.
  distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  // The payout package is shared TS source from the monorepo; transpile it.
  transpilePackages: ["@exact-match/payout"],
};

export default nextConfig;
