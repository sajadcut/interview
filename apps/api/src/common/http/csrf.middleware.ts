import type { NextFunction, Request, Response } from "express";
import { SESSION_POLICY } from "../../auth/session-policy";
import { CANDIDATE_SESSION_COOKIE } from "../../auth/candidate-session.service";
import { buildCorsOrigin } from "./cors";
import { getEnv } from "../../config/env";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hasCookie(request: Request, name: string): boolean {
  const raw = request.header("cookie") ?? "";
  return raw.split(";").some((part) => part.trim().startsWith(`${name}=`));
}

export function csrfProtectionMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    next();
    return;
  }

  const cookieAuthenticated =
    hasCookie(request, SESSION_POLICY.COOKIE_NAME) ||
    hasCookie(request, SESSION_POLICY.REFRESH_COOKIE_NAME) ||
    hasCookie(request, CANDIDATE_SESSION_COOKIE);
  if (!cookieAuthenticated) {
    next();
    return;
  }

  const origin = request.header("origin")?.trim();
  if (!origin) {
    response.status(403).json({
      statusCode: 403,
      error: "Forbidden",
      message: "Origin header is required for cookie-authenticated state changes",
    });
    return;
  }

  const configured = buildCorsOrigin(getEnv().CORS_ORIGIN);
  const allowed = configured === "*" ? false : configured.includes(origin);
  if (!allowed) {
    response.status(403).json({
      statusCode: 403,
      error: "Forbidden",
      message: "Cross-origin cookie-authenticated state change rejected",
    });
    return;
  }

  next();
}
