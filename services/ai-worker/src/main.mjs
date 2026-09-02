import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { AiWorkerApiClient } from "./api-client.mjs";
import { AiWorkerRuntime } from "./runtime.mjs";

function integerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

const sharedSecret = process.env.AI_WORKER_SHARED_SECRET?.trim();
if (!sharedSecret) {
  throw new Error("AI_WORKER_SHARED_SECRET is required to start services/ai-worker");
}

const workerId =
  process.env.AI_WORKER_ID?.trim() || `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const client = new AiWorkerApiClient({
  baseUrl: process.env.AI_WORKER_API_URL?.trim() || "http://127.0.0.1:4000",
  sharedSecret,
  requestTimeoutMs: integerEnv("AI_WORKER_REQUEST_TIMEOUT_MS", 10000, 1000, 60000),
});

const processors = new Map([
  [
    "system.healthcheck",
    async ({ workerId: activeWorkerId }) => ({
      ok: true,
      workerId: activeWorkerId,
      processedAt: new Date().toISOString(),
    }),
  ],
]);

const runtime = new AiWorkerRuntime({
  client,
  processors,
  workerId,
  concurrency: integerEnv("AI_WORKER_CONCURRENCY", 2, 1, 32),
  pollIntervalMs: integerEnv("AI_WORKER_POLL_INTERVAL_MS", 1000, 100, 60000),
  leaseDurationMs: integerEnv("AI_WORKER_LEASE_MS", 120000, 5000, 300000),
  heartbeatIntervalMs: integerEnv("AI_WORKER_HEARTBEAT_MS", 15000, 1000, 120000),
});

const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown.abort(new Error(`${signal} received`)));
}

console.log(`AI worker ${workerId} started with ${runtime.concurrency} processing lane(s)`);
await runtime.runForever(shutdown.signal);
console.log(`AI worker ${workerId} stopped`);
