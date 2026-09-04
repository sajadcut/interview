import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { PrivacyWorkerApiClient, PrivacyWorkerApiError } from "./api-client.mjs";

function intEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

const baseUrl = process.env.PRIVACY_WORKER_API_URL || "http://127.0.0.1:4100";
const sharedSecret = process.env.PRIVACY_WORKER_SHARED_SECRET?.trim() || "";
if (!sharedSecret) throw new Error("PRIVACY_WORKER_SHARED_SECRET is required");

const workerId = (process.env.PRIVACY_WORKER_ID || `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`).slice(0, 160);
const pollIntervalMs = intEnv("PRIVACY_WORKER_POLL_INTERVAL_MS", 1000, 100, 60000);
const leaseMs = intEnv("PRIVACY_WORKER_LEASE_MS", 120000, 5000, 300000);
const heartbeatMs = intEnv("PRIVACY_WORKER_HEARTBEAT_MS", 15000, 1000, 60000);
const requestTimeoutMs = intEnv("PRIVACY_WORKER_REQUEST_TIMEOUT_MS", 10000, 1000, 60000);
const executionTimeoutMs = intEnv("PRIVACY_WORKER_EXECUTION_TIMEOUT_MS", 600000, 30000, 3600000);
const api = new PrivacyWorkerApiClient({ baseUrl, sharedSecret, requestTimeoutMs });
let stopping = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function classifyFailure(error) {
  if (error instanceof PrivacyWorkerApiError && error.status === 409) {
    return { leaseLost: true, retryable: false, errorCode: "STALE_LEASE", errorMessage: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  const permanent = error instanceof PrivacyWorkerApiError && [400, 401, 403, 404, 422].includes(error.status);
  return {
    leaseLost: false,
    retryable: !permanent,
    errorCode: permanent ? "INVALID_PRIVACY_DELETION_JOB" : "PRIVACY_DELETION_FAILURE",
    errorMessage: message.slice(0, 4000),
  };
}

async function processJob(job) {
  const heartbeat = setInterval(() => {
    void api
      .heartbeat({ jobId: job.jobId, leaseToken: job.leaseToken, workerId, leaseDurationMs: leaseMs })
      .catch((error) => console.error("privacy deletion heartbeat failed", error));
  }, Math.min(heartbeatMs, Math.max(1000, Math.floor(leaseMs / 3))));
  heartbeat.unref?.();

  try {
    const result = await api.execute(
      { jobId: job.jobId, leaseToken: job.leaseToken, workerId },
      executionTimeoutMs,
    );
    console.log(`privacy deletion job ${job.jobId} finished with ${result?.state ?? "unknown"}`);
  } catch (error) {
    const failure = classifyFailure(error);
    console.error(`privacy deletion job ${job.jobId} failed`, error);
    if (!failure.leaseLost) {
      await api.fail({
        jobId: job.jobId,
        leaseToken: job.leaseToken,
        workerId,
        retryable: failure.retryable,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
      });
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function main() {
  console.log(`privacy-worker ${workerId} starting`);
  while (!stopping) {
    try {
      const job = await api.claim({ workerId, leaseDurationMs: leaseMs });
      if (!job) {
        await sleep(pollIntervalMs);
        continue;
      }
      await processJob(job);
    } catch (error) {
      console.error("privacy worker loop failure", error);
      await sleep(pollIntervalMs);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
  });
}

await main();
