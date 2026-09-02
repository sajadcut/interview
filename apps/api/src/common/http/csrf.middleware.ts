import type { NextFunction, Request, Response } from "express";
import { CANDIDATE_SESSION_COOKIE } from "../../auth/candidate-session.service";
import { SESSION_POLICY } from "../../auth/session-policy";
import { getEnv } from "../../config/env";
import { buildCorsOrigin, type CorsOriginConfig } from "./cors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hasCookie(request: Request, name: string): boolean {
  const raw = request.header("cookie") ?? "";
  return raw.split(";").some((part) => part.trim().startsWith(`${name}=`));
}

export type CsrfDecision =
  | { allowed: true }
  | { allowed: false; message: string };

export function evaluateCsrfProtection(input: {
  method: string;
  cookieAuthenticated: boolean;
  origin?: string;
  configuredOrigins: CorsOriginConfig;
}): CsrfDecision {
  if (SAFE_METHODS.has(input.method.toUpperCase()) || !input.cookieAuthenticated) {
    return { allowed: true };
  }

  const origin = input.origin?.trim();
  if (!origin) {
    return {
      allowed: false,
      message: "Origin header is required for cookie-authenticated state changes",
    };
  }

  if (input.configuredOrigins === "*" || !input.configuredOrigins.includes(origin)) {
    return {
      allowed: false,
      message: "Cross-origin cookie-authenticated state change rejected",
    };
  }

  return { allowed: true };
}

export function csrfProtectionMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const cookieAuthenticated =
    hasCookie(request, SESSION_POLICY.COOKIE_NAME) ||
    hasCookie(request, SESSION_POLICY.REFRESH_COOKIE_NAME) ||
    hasCookie(request, CANDIDATE_SESSION_COOKIE);
  const origin = request.header("origin")?.trim();
  const decision = evaluateCsrfProtection({
    method: request.method,
    cookieAuthenticated,
    ...(origin ? { origin } : {}),
    configuredOrigins: buildCorsOrigin(getEnv().CORS_ORIGIN),
  });

  if (decision.allowed) {
    next();
    return;
  }

  response.status(403).json({
    statusCode: 403,
    error: "Forbidden",
    message: decision.message,
  });
}
