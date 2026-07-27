import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Static security headers. The Content-Security-Policy is set per request in
  // proxy.ts instead, so it can carry a fresh nonce for script-src.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
  // Allow LAN devices (e.g. phone testing over WiFi) to load dev resources.
  // Dev-only setting — has no effect on production builds.
  allowedDevOrigins: ["192.168.1.*"],
  // These packages use native bindings or complex require() chains —
  // keep them out of the webpack bundle so Node.js resolves them at runtime.
  serverExternalPackages: [
    "pdfkit",
    "swissqrbill",
    "sharp",
    "jimp",
    "@jimp/core",
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
    "@prisma/driver-adapter-utils",
  ],
};

export default nextConfig;
