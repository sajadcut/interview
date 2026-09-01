import type { NextFunction, Request, Response } from "express";

export function securityHeadersMiddleware(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader(
    "permissions-policy",
    "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:",
  );
  if (process.env.NODE_ENV === "production") {
    response.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  next();
}
