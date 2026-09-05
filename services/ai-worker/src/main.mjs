#!/usr/bin/env node
import process from "node:process";
import { AiWorkerApiClient } from "./api-client.mjs";
import { capabilityPromptDefinitions, createCapabilityProcessors } from "./capabilities.mjs";
import { LLMProviderLayer, PromptRegistry } from "./llm-provider.mjs";
import { createOpenAiCompatibleProvider, createUnavailableProvider } from "./openai-compatible-provider.mjs";
import { AiWorkerRuntime } from "./runtime.mjs";

function integerEnv(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function providerFromEnvironment() {
  const selected = (process.env.LLM_PROVIDER ?? "disabled").trim().toLowerCase();
  if (selected === "openai-compatible") return createOpenAiCompatibleProvider(process.env);
  if (selected === "disabled") return createUnavailableProvider();
  throw new Error(`Unsupported LLM_PROVIDER ${selected}`);
}

const sharedSecret = process.env.AI_WORKER_SHARED_SECRET?.trim();
if (!sharedSecret) throw new Error("AI_WORKER_SHARED_SECRET is required");

const promptRegistry = new PromptRegistry(
  capabilityPromptDefinitions().map(({ capability: _capability, ...definition }) => definition),
);
const llm = new LLMProviderLayer({
  providers: [providerFromEnvironment()],
  promptRegistry,
  timeoutMs: integerEnv("LLM_TIMEOUT_MS", 30_000),
  maxAttemptsPerProvider: integerEnv("LLM_MAX_ATTEMPTS_PER_PROVIDER", 2),
});
const processors = createCapabilityProcessors({ llm });
processors.set("system.healthcheck", async ({ job }) => ({
  schemaVersion: "system-healthcheck.v1",
  ok: true,
  jobId: job.id,
  processedAt: new Date().toISOString(),
}));

const client = new AiWorkerApiClient({
  baseUrl: process.env.AI_WORKER_API_BASE_URL ?? "http://127.0.0.1:4000",
  sharedSecret,
  requestTimeoutMs: integerEnv("AI_WORKER_REQUEST_TIMEOUT_MS", 10_000),
});
const runtime = new AiWorkerRuntime({
  client,
  processors,
  workerId: process.env.AI_WORKER_ID ?? `ai-worker-${process.pid}`,
  concurrency: integerEnv("AI_WORKER_CONCURRENCY", 1),
  pollIntervalMs: integerEnv("AI_WORKER_POLL_INTERVAL_MS", 1_000),
  leaseDurationMs: integerEnv("AI_WORKER_LEASE_DURATION_MS", 120_000),
  heartbeatIntervalMs: integerEnv("AI_WORKER_HEARTBEAT_INTERVAL_MS", 15_000),
});

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => controller.abort(new Error(signal)));
}

await runtime.runForever(controller.signal);
