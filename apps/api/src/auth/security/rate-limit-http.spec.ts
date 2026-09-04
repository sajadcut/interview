import assert from "node:assert/strict";
import test from "node:test";
import type { ArgumentsHost } from "@nestjs/common";
import type { Response } from "express";
import { HttpExceptionFilter } from "../../common/http/http-exception.filter";
import { RateLimitExceededException } from "./auth-rate-limit.service";

test("HTTP exception filter emits standard rate-limit body and Retry-After headers", () => {
  const headers = new Map<string, string>();
  let statusCode = 0;
  let body: Record<string, unknown> | undefined;

  const response = {
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), String(value));
      return this;
    },
    status(value: number) {
      statusCode = value;
      return this;
    },
    json(value: Record<string, unknown>) {
      body = value;
      return this;
    },
  } as unknown as Response;

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;

  new HttpExceptionFilter().catch(
    new RateLimitExceededException({
      limit: 6,
      remaining: 0,
      retryAfterSeconds: 91,
      resetAt: "2026-09-04T18:00:00.000Z",
    }),
    host,
  );

  assert.equal(statusCode, 429);
  assert.equal(headers.get("retry-after"), "91");
  assert.equal(headers.get("x-ratelimit-limit"), "6");
  assert.equal(headers.get("x-ratelimit-remaining"), "0");
  assert.equal(headers.get("x-ratelimit-reset"), "2026-09-04T18:00:00.000Z");
  assert.equal(body?.error, "RATE_LIMITED");
  assert.equal(body?.retryAfterSeconds, 91);
});
