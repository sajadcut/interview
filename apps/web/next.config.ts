import type { NextConfig } from "next";
import { loadRootEnvironment } from "./lib/root-env";

loadRootEnvironment();

function addUrlOrigin(target: Set<string>, value: string | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  try {
    target.add(new URL(trimmed).origin);
  } catch {
    // Environment validation in application code reports malformed URLs.
  }
}

function addLiveKitConnectOrigins(target: Set<string>, value: string | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed) return;

  try {
    const liveKitUrl = new URL(trimmed);
    if (liveKitUrl.protocol !== "ws:" && liveKitUrl.protocol !== "wss:") return;

    target.add(liveKitUrl.origin);

    // The LiveKit browser client may use an HTTP(S) validation fallback while
    // establishing the signal connection, so allow only the matching exact origin.
    const fallbackUrl = new URL(liveKitUrl.toString());
    fallbackUrl.protocol = liveKitUrl.protocol === "wss:" ? "https:" : "http:";
    target.add(fallbackUrl.origin);
  } catch {
    // Environment validation in application code reports malformed LiveKit URLs.
  }
}

function webSecurityHeaders(): Array<{ key: string; value: string }> {
  const production = process.env.NODE_ENV === "production";
  const connectSources = new Set(["'self'", "ws:", "wss:"]);

  addUrlOrigin(connectSources, process.env.NEXT_PUBLIC_API_URL);
  addUrlOrigin(connectSources, process.env.API_INTERNAL_URL);
  addLiveKitConnectOrigins(connectSources, process.env.LIVEKIT_URL);

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
