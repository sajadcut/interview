import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { RetentionWorkerApiClient, RetentionWorkerApiError } from "./api-client.mjs";

function intEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function booleanEnv(name, fallback) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export function retentionCycleKey(date = new Date()) {
  return `daily:${date.toISOString().slice(0, 10)}`;
}

const baseUrl = process.env.RETENTION_WORKER_API_URL || "http://127.0.0.1:4100";
const sharedSecret = process.env.RETENTION_WORKER_SHARED_SECRET?.trim() || "";
if (!sharedSecret) throw new Error("RETENTION_WORKER_SHARED_SECRET is required");

const workerId = (
  process.env.RETENTION_WORKER_ID ||
  `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`
).slice(0, 160);
const pollIntervalMs = intEnv("RETENTION_WORKER_POLL_INTERVAL_MS", 5000, 250, 60000);
const scheduleIntervalMs = intEnv(
  "RETENTION_WORKER_SCHEDULE_INTERVAL_MS",
  3600000,
  60000,
  86400000,
);
const leaseMs = intEnv("RETENTION_WORKER_LEASE_MS", 120000, 5000, 300000);
const heartbeatMs = intEnv("RETENTION_WORKER_HEARTBEAT_MS", 15000, 1000, 60000);
const requestTimeoutMs = intEnv("RETENTION_WORKER_REQUEST_TIMEOUT_MS", 10000, 1000, 60000);
const executionTimeoutMs = intEnv(
  "RETENTION_WORKER_EXECUTION_TIMEOUT_MS",
  600000,
  30000,
  3600000,
);
const dryRun = booleanEnv("RETENTION_WORKER_DRY_RUN", true);
const api = new RetentionWorkerApiClient({ baseUrl, sharedSecret, requestTimeoutMs });
let stopping = false;
let lastScheduleAt = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function classifyFailure(error) {
  if (error instanceof RetentionWorkerApiError && error.status === 409) {
    return { leaseLost: true, retryable: false, errorCode: "STALE_LEASE", errorMessage: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  const permanent =
    error instanceof RetentionWorkerApiError && [400, 401, 403, 404, 422].includes(error.status);
  return {
    leaseLost: false,
    retryable: !permanent,
    errorCode: permanent ? "INVALID_RETENTION_JOB" : "RETENTION_EXECUTION_FAILURE",
    errorMessage: message.slice(0, 4000),
  };
}

async function scheduleIfDue() {
  const now = Date.now();
  if (now - lastScheduleAt < scheduleIntervalMs) return;
  await api.schedule({ cycleKey: retentionCycleKey(), dryRun });
  lastScheduleAt = now;
}

async function processJob(job) {
  const heartbeat = setInterval(() => {
    void api
      .heartbeat({ jobId: job.jobId, leaseToken: job.leaseToken, workerId, leaseDurationMs: leaseMs })
      .catch((error) => console.error("retention heartbeat failed", error));
  }, Math.min(heartbeatMs, Math.max(1000, Math.floor(leaseMs / 3))));
  heartbeat.unref?.();

  try {
    const result = await api.execute(
      { jobId: job.jobId, leaseToken: job.leaseToken, workerId },
      executionTimeoutMs,
    );
    console.log(`retention job ${job.jobId} finished with ${result?.state ?? "unknown"}`);
  } catch (error) {
    const failure = classifyFailure(error);
    console.error(`retention job ${job.jobId} failed`, error);
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
  console.log(`retention-worker ${workerId} starting; dryRun=${dryRun}`);
  while (!stopping) {
    try {
      await scheduleIfDue();
      const job = await api.claim({ workerId, leaseDurationMs: leaseMs });
      if (!job) {
        await sleep(pollIntervalMs);
        continue;
      }
      await processJob(job);
    } catch (error) {
      console.error("retention worker loop failure", error);
      await sleep(pollIntervalMs);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
  });
}

if (process.env.NODE_ENV !== "test") {
  await main();
}
