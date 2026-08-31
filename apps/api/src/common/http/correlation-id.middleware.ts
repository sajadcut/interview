import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type RequestWithContext = Request & { requestId?: string };

export function correlationIdMiddleware(
  request: RequestWithContext,
  response: Response,
  next: NextFunction,
): void {
  const incoming = request.header("x-request-id")?.trim();
  const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
  request.requestId = requestId;
  response.setHeader("x-request-id", requestId);
  next();
}
