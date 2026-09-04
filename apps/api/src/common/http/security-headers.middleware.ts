import type { NextFunction, Request, Response } from "express";

const SENSITIVE_PATH_PREFIXES = [
  "/auth",
  "/v1/candidate-auth",
  "/v1/candidates",
  "/v1/interviews",
  "/v1/privacy",
  "/v1/audit",
  "/internal/",
] as const;

function isDocumentationPath(pathname: string): boolean {
  return pathname === "/docs" || pathname.startsWith("/docs/");
}

function isSensitivePath(pathname: string): boolean {
  return SENSITIVE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function securityHeadersFor(
  pathname: string,
  production = process.env.NODE_ENV === "production",
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-xss-protection": "0",
    "x-dns-prefetch-control": "off",
    "x-download-options": "noopen",
    "x-permitted-cross-domain-policies": "none",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "origin-agent-cluster": "?1",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "content-security-policy": isDocumentationPath(pathname)
      ? "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
      : "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'",
  };

  if (isSensitivePath(pathname)) {
    headers["cache-control"] = "private, no-store, max-age=0";
    headers.pragma = "no-cache";
  }

  if (production) {
    headers["strict-transport-security"] = "max-age=63072000; includeSubDomains; preload";
  }

  return headers;
}

export function securityHeadersMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.removeHeader("x-powered-by");
  response.removeHeader("server");
  for (const [name, value] of Object.entries(securityHeadersFor(request.path))) {
    response.setHeader(name, value);
  }
  next();
}
