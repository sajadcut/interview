import type { NextConfig } from "next";
import { loadRootEnvironment } from "./lib/root-env";

loadRootEnvironment();

function webSecurityHeaders(): Array<{ key: string; value: string }> {
  const production = process.env.NODE_ENV === "production";
  const connectSources = new Set(["'self'", "ws:", "wss:"]);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (apiUrl) {
    try {
      connectSources.add(new URL(apiUrl).origin);
    } catch {
      // Environment validation in application code reports malformed API URLs.
    }
  }

  const scriptSources = production
    ? "'self' 'unsafe-inline'"
    : "'self' 'unsafe-inline' 'unsafe-eval'";
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSources}`,
    `connect-src ${[...connectSources].join(" ")}`,
    "worker-src 'self' blob:",
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
    },
    ...(production
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ]
      : []),
  ];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@interview/api-client", "@interview/ui"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: webSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
