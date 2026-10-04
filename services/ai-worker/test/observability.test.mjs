import assert from "node:assert/strict";
import test from "node:test";
import {
  contextFromHeaders,
  contextFromJob,
  currentTraceContext,
  withTraceContext,
} from "../src/observability.mjs";

test("AI worker restores the originating API trace from an AI job payload", async () => {
  const context = contextFromJob({
    id: "11111111-1111-4111-8111-111111111111",
    capability: "candidate.job_match",
    payload: {
      observability: {
        traceId: "0123456789abcdef0123456789abcdef",
        requestId: "request-12345678",
        parentSpanId: "0123456789abcdef",
      },
    },
  });

  await withTraceContext(context, async () => {
    await Promise.resolve();
    assert.equal(currentTraceContext().traceId, "0123456789abcdef0123456789abcdef");
    assert.equal(currentTraceContext().requestId, "request-12345678");
    assert.equal(currentTraceContext().jobId, "11111111-1111-4111-8111-111111111111");
    assert.equal(currentTraceContext().capability, "candidate.job_match");
  });
});

test("realtime interviewer accepts W3C trace context", () => {
  const context = contextFromHeaders({
    traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    "x-request-id": "request-abcdefgh",
  });
  assert.equal(context.traceId, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(context.parentSpanId, "bbbbbbbbbbbbbbbb");
  assert.equal(context.requestId, "request-abcdefgh");
});
