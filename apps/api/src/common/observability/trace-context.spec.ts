import assert from "node:assert/strict";
import test from "node:test";
import {
  childTraceContext,
  createRequestId,
  createTraceId,
  currentTraceContext,
  parseTraceParent,
  runWithTraceContext,
} from "./trace-context";

test("trace context is preserved across async work and creates child spans", async () => {
  const traceId = createTraceId();
  const requestId = createRequestId();
  await runWithTraceContext(
    { traceId, requestId, spanId: "0123456789abcdef" },
    async () => {
      await Promise.resolve();
      assert.equal(currentTraceContext()?.traceId, traceId);
      assert.equal(currentTraceContext()?.requestId, requestId);
      const child = childTraceContext();
      assert.equal(child.traceId, traceId);
      assert.equal(child.requestId, requestId);
      assert.equal(child.parentSpanId, "0123456789abcdef");
      assert.match(child.spanId, /^[a-f0-9]{16}$/);
    },
  );
  assert.equal(currentTraceContext(), undefined);
});

test("W3C traceparent parsing rejects invalid zero identifiers", () => {
  assert.deepEqual(
    parseTraceParent("00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"),
    {
      traceId: "0123456789abcdef0123456789abcdef",
      parentSpanId: "0123456789abcdef",
    },
  );
  assert.equal(
    parseTraceParent("00-00000000000000000000000000000000-0123456789abcdef-01"),
    null,
  );
});
