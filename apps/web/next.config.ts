import type { NextConfig } from "next";
import path from "node:path";

// Single source of truth for secrets: the monorepo root .env (API and worker read the same file).
try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  /* no .env (CI / production use real environment variables) */
}

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const config: NextConfig = {
  transpilePackages: ["@sichttakt/core", "@sichttakt/db", "@sichttakt/shared", "@sichttakt/config", "@sichttakt/social-adapters"],
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  agentRules: false,
  // Development only: allow the dev server to be opened through a Cloudflare quick tunnel / the local HTTPS proxy.
  allowedDevOrigins: ["*.trycloudflare.com", "puffer.127.0.0.1.nip.io"],
  experimental: { serverActions: { bodySizeLimit: "512mb" } }, // bulk import ZIPs; production streams to object storage
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default config;
