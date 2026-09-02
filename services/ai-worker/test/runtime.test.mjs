import assert from "node:assert/strict";
import test from "node:test";
import { AiWorkerRuntime, RetryableJobError } from "../src/runtime.mjs";

function job(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    capability: "test.echo",
    payload: { value: 42 },
    leaseToken: "22222222-2222-4222-8222-222222222222",
    timeoutMs: 1000,
    ...overrides,
  };
}

function clientWithClaim(claimedJob) {
  const calls = [];
  return {
    calls,
    async claim(input) {
      calls.push(["claim", input]);
      return claimedJob;
    },
    async heartbeat(input) {
      calls.push(["heartbeat", input]);
      return claimedJob;
    },
    async succeed(input) {
      calls.push(["succeed", input]);
      return { ...claimedJob, status: "succeeded" };
    },
    async fail(input) {
      calls.push(["fail", input]);
      return { ...claimedJob, status: input.retryable ? "retry_scheduled" : "dead_letter" };
    },
  };
}

test("runOnce returns false when the durable queue has no work", async () => {
  const client = clientWithClaim(null);
  const runtime = new AiWorkerRuntime({ client, processors: new Map(), workerId: "worker-a" });
  assert.equal(await runtime.runOnce(), false);
  assert.equal(client.calls.filter(([name]) => name === "claim").length, 1);
});

test("successful processor result is acknowledged with the active lease", async () => {
  const claimedJob = job();
  const client = clientWithClaim(claimedJob);
  const runtime = new AiWorkerRuntime({
    client,
    workerId: "worker-a",
    processors: new Map([["test.echo", async ({ payload }) => ({ echoed: payload.value })]]),
  });

  assert.equal(await runtime.runOnce(), true);
  const success = client.calls.find(([name]) => name === "succeed")?.[1];
  assert.deepEqual(success, {
    jobId: claimedJob.id,
    leaseToken: claimedJob.leaseToken,
    workerId: "worker-a",
    result: { echoed: 42 },
  });
  assert.equal(client.calls.some(([name]) => name === "fail"), false);
});

test("retryable processor failures are reported for queue backoff", async () => {
  const client = clientWithClaim(job());
  const runtime = new AiWorkerRuntime({
    client,
    workerId: "worker-a",
    processors: new Map([
      [
        "test.echo",
        async () => {
          throw new RetryableJobError("TEMPORARY_PROVIDER_FAILURE", "provider is temporarily unavailable");
        },
      ],
    ]),
  });

  await runtime.runOnce();
  const failure = client.calls.find(([name]) => name === "fail")?.[1];
  assert.equal(failure.retryable, true);
  assert.equal(failure.errorCode, "TEMPORARY_PROVIDER_FAILURE");
});

test("unsupported capabilities are dead-letter candidates instead of being silently executed", async () => {
  const client = clientWithClaim(job({ capability: "interview.evaluate" }));
  const runtime = new AiWorkerRuntime({ client, processors: new Map(), workerId: "worker-a" });

  await runtime.runOnce();
  const failure = client.calls.find(([name]) => name === "fail")?.[1];
  assert.equal(failure.retryable, false);
  assert.equal(failure.errorCode, "UNSUPPORTED_CAPABILITY");
});

test("processor timeout is reported as retryable and aborts the processor signal", async () => {
  const client = clientWithClaim(job({ timeoutMs: 250 }));
  let aborted = false;
  const runtime = new AiWorkerRuntime({
    client,
    workerId: "worker-a",
    processors: new Map([
      [
        "test.echo",
        ({ signal }) =>
          new Promise((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                resolve({ ignoredAfterAbort: true });
              },
              { once: true },
            );
          }),
      ],
    ]),
  });

  await runtime.runOnce();
  const failure = client.calls.find(([name]) => name === "fail")?.[1];
  assert.equal(aborted, true);
  assert.equal(failure.retryable, true);
  assert.equal(failure.errorCode, "JOB_TIMEOUT");
});
