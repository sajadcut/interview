import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";

export interface TraceContext {
  traceId: string;
  requestId: string;
  spanId: string;
  parentSpanId?: string;
  jobId?: string;
  capability?: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

export function createTraceId(): string {
  return randomBytes(16).toString("hex");
}

export function createSpanId(): string {
  return randomBytes(8).toString("hex");
}

export function createRequestId(): string {
  return randomUUID();
}

export function validTraceId(value: string | undefined): value is string {
  return Boolean(value && /^[a-f0-9]{32}$/i.test(value));
}

export function validRequestId(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9._:-]{8,128}$/.test(value));
}

export function parseTraceParent(value: string | undefined): { traceId: string; parentSpanId: string } | null {
  if (!value) return null;
  const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-[a-f0-9]{2}$/i.exec(value.trim());
  if (!match?.[1] || !match[2] || /^0+$/.test(match[1]) || /^0+$/.test(match[2])) return null;
  return { traceId: match[1].toLowerCase(), parentSpanId: match[2].toLowerCase() };
}

export function currentTraceContext(): TraceContext | undefined {
  return storage.getStore();
}

export function runWithTraceContext<T>(context: TraceContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function childTraceContext(overrides: Partial<TraceContext> = {}): TraceContext {
  const current = currentTraceContext();
  const context: TraceContext = {
    traceId: overrides.traceId ?? current?.traceId ?? createTraceId(),
    requestId: overrides.requestId ?? current?.requestId ?? createRequestId(),
    spanId: overrides.spanId ?? createSpanId(),
  };
  const parentSpanId = overrides.parentSpanId ?? current?.spanId;
  const jobId = overrides.jobId ?? current?.jobId;
  const capability = overrides.capability ?? current?.capability;
  if (parentSpanId) context.parentSpanId = parentSpanId;
  if (jobId) context.jobId = jobId;
  if (capability) context.capability = capability;
  return context;
}

export function traceParentHeader(context = currentTraceContext()): string | undefined {
  if (!context) return undefined;
  return `00-${context.traceId}-${context.spanId}-01`;
}
