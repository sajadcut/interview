import assert from "node:assert/strict";
import test from "node:test";
import { RetentionWorkerApiClient, RetentionWorkerApiError } from "../src/api-client.mjs";

test("retention worker client authenticates schedule and lease requests", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new RetentionWorkerApiClient({
      baseUrl: "http://api.local/",
      sharedSecret: "retention-secret",
      requestTimeoutMs: 5000,
    });
    await client.schedule({ cycleKey: "daily:2026-09-04", dryRun: true });
    await client.heartbeat({
      jobId: "a69f2ac2-56b2-4ca8-bb73-eb8f012a91c0",
      leaseToken: "dc6123aa-9fe9-4b29-a166-1703df6d8d4f",
      workerId: "worker-1",
      leaseDurationMs: 120000,
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "http://api.local/internal/retention-worker/schedule");
    assert.equal(calls[0].init.headers["x-retention-worker-secret"], "retention-secret");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      cycleKey: "daily:2026-09-04",
      dryRun: true,
    });
    assert.match(calls[1].url, /\/heartbeat$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retention worker client preserves HTTP failure classification", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "stale retention lease" }), { status: 409 });

  try {
    const client = new RetentionWorkerApiClient({
      baseUrl: "http://api.local",
      sharedSecret: "retention-secret",
    });
    await assert.rejects(
      () =>
        client.execute({
          jobId: "a69f2ac2-56b2-4ca8-bb73-eb8f012a91c0",
          leaseToken: "dc6123aa-9fe9-4b29-a166-1703df6d8d4f",
          workerId: "worker-1",
        }),
      (error) =>
        error instanceof RetentionWorkerApiError &&
        error.status === 409 &&
        /stale retention lease/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
