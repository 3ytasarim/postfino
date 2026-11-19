import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // Dev only: let the page load its scripts when opened through a Cloudflare quick tunnel.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // One canonical host: postfino.com (any path) -> https://www.postfino.com with a single 308.
  async redirects() {
    return [{ source: "/:path*", has: [{ type: "host", value: "postfino.com" }], destination: "https://www.postfino.com/:path*", permanent: true }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // Brand images in /public never change under the same name: cache them for a long time.
      { source: "/brand/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=2592000, stale-while-revalidate=86400" }] },
    ];
  },
};
export default config;
