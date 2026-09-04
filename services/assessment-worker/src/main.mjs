import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { AssessmentWorkerApiClient } from "./api-client.mjs";
import { executeAssessmentJob } from "./sandbox.mjs";

function intEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

const baseUrl = process.env.ASSESSMENT_WORKER_API_URL || "http://127.0.0.1:4100";
const sharedSecret = process.env.ASSESSMENT_WORKER_SHARED_SECRET?.trim() || "";
if (!sharedSecret) throw new Error("ASSESSMENT_WORKER_SHARED_SECRET is required");

const workerId = (process.env.ASSESSMENT_WORKER_ID || `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`).slice(0, 160);
const pollIntervalMs = intEnv("ASSESSMENT_WORKER_POLL_INTERVAL_MS", 1000, 100, 60000);
const leaseMs = intEnv("ASSESSMENT_WORKER_LEASE_MS", 120000, 5000, 300000);
const heartbeatMs = intEnv("ASSESSMENT_WORKER_HEARTBEAT_MS", 15000, 1000, 60000);
const requestTimeoutMs = intEnv("ASSESSMENT_WORKER_REQUEST_TIMEOUT_MS", 10000, 1000, 60000);
const api = new AssessmentWorkerApiClient({ baseUrl, sharedSecret, requestTimeoutMs });
let stopping = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function classifyFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  const permanent =
    message.includes("Unsupported assessment language") ||
    message.includes("runnerPolicy.testCases") ||
    message.includes("requires sourceText") ||
    message.includes("must prohibit network access") ||
    message.includes("ASSESSMENT_CONTAINER_RUNTIME");
  return {
    retryable: !permanent,
    errorCode: permanent ? "INVALID_ASSESSMENT_JOB" : "ASSESSMENT_SANDBOX_FAILURE",
    errorMessage: message.slice(0, 4000),
  };
}

async function processJob(job) {
  const heartbeat = setInterval(() => {
    void api
      .heartbeat({ jobId: job.jobId, leaseToken: job.leaseToken, workerId, leaseDurationMs: leaseMs })
      .catch((error) => console.error("assessment heartbeat failed", error));
  }, Math.min(heartbeatMs, Math.max(1000, Math.floor(leaseMs / 3))));
  heartbeat.unref?.();

  try {
    const result = await executeAssessmentJob(job);
    await api.succeed({ jobId: job.jobId, leaseToken: job.leaseToken, workerId, result });
    console.log(`assessment job ${job.jobId} completed with ${result.status}`);
  } catch (error) {
    const failure = classifyFailure(error);
    console.error(`assessment job ${job.jobId} failed`, error);
    await api.fail({ jobId: job.jobId, leaseToken: job.leaseToken, workerId, ...failure });
  } finally {
    clearInterval(heartbeat);
  }
}

async function main() {
  console.log(`assessment-worker ${workerId} starting; runtime=${process.env.ASSESSMENT_CONTAINER_RUNTIME || "docker"}`);
  while (!stopping) {
    try {
      const job = await api.claim({ workerId, leaseDurationMs: leaseMs });
      if (!job) {
        await sleep(pollIntervalMs);
        continue;
      }
      await processJob(job);
    } catch (error) {
      console.error("assessment worker loop failure", error);
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
