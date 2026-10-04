import type { NextFunction, Request, Response } from "express";
import {
  createRequestId,
  createSpanId,
  createTraceId,
  parseTraceParent,
  runWithTraceContext,
  validRequestId,
  validTraceId,
} from "../observability/trace-context";

export type RequestWithContext = Request & {
  requestId?: string;
  traceId?: string;
  spanId?: string;
};

export function correlationIdMiddleware(
  request: RequestWithContext,
  response: Response,
  next: NextFunction,
): void {
  const traceParent = parseTraceParent(request.header("traceparent")?.trim());
  const incomingTraceId = request.header("x-trace-id")?.trim();
  const incomingRequestId = request.header("x-request-id")?.trim();

  const traceId = traceParent?.traceId ?? (validTraceId(incomingTraceId) ? incomingTraceId.toLowerCase() : createTraceId());
  const requestId = validRequestId(incomingRequestId) ? incomingRequestId : createRequestId();
  const spanId = createSpanId();

  request.requestId = requestId;
  request.traceId = traceId;
  request.spanId = spanId;

  response.setHeader("x-request-id", requestId);
  response.setHeader("x-trace-id", traceId);
  response.setHeader("traceparent", `00-${traceId}-${spanId}-01`);

  runWithTraceContext(
    {
      traceId,
      requestId,
      spanId,
      ...(traceParent?.parentSpanId ? { parentSpanId: traceParent.parentSpanId } : {}),
    },
    next,
  );
}
