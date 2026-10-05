#!/usr/bin/env node
import { configureWorkerTls } from "../../../scripts/worker-tls.mjs";
import process from "node:process";
import { interviewerPromptDefinition } from "./interviewer-capability.mjs";
import { persianPronunciationPromptDefinition } from "./persian-pronunciation-capability.mjs";
import { createInterviewerHttpServer } from "./interviewer-http.mjs";
import { LLMProviderLayer, PromptRegistry } from "./llm-provider.mjs";
import { createConfiguredProvider, providerInfoFromEnvironment } from "./provider-factory.mjs";
import { installInstrumentedFetch, logPath, writeLog } from "./observability.mjs";

configureWorkerTls();
installInstrumentedFetch();

function integerEnv(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function providerFromEnvironment() {
  const info = providerInfoFromEnvironment(process.env);
  if (!info.enabled) return { provider: createConfiguredProvider(process.env), info };
  if (!info.configured) return { provider: createConfiguredProvider({ ...process.env, LLM_PROVIDER: "disabled" }), info };
  return { provider: createConfiguredProvider(process.env), info };
}

const sharedSecret = process.env.AI_WORKER_SHARED_SECRET?.trim();
if (!sharedSecret) throw new Error("AI_WORKER_SHARED_SECRET is required");

const selected = providerFromEnvironment();
const promptRegistry = new PromptRegistry([
  interviewerPromptDefinition,
  persianPronunciationPromptDefinition,
]);
const llm = new LLMProviderLayer({
  providers: [selected.provider],
  promptRegistry,
  timeoutMs: integerEnv("LLM_INTERVIEWER_PROVIDER_TIMEOUT_MS", 10_000, 500, 30_000),
  maxAttemptsPerProvider: integerEnv("LLM_INTERVIEWER_MAX_ATTEMPTS", 1, 1, 2),
  retryInitialDelayMs: integerEnv("LLM_INTERVIEWER_RETRY_DELAY_MS", 100, 0, 2_000),
  retryMaxDelayMs: 2_000,
});

const host = (process.env.AI_INTERVIEWER_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
const port = integerEnv("AI_INTERVIEWER_PORT", 9040, 1, 65_535);
const server = createInterviewerHttpServer({
  llm,
  sharedSecret,
  providerInfo: selected.info,
  providerReadiness: (options) => selected.provider.checkReadiness(options),
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, host, () => {
    server.off("error", reject);
    writeLog("info", "interviewer.started", {
      host,
      port,
      provider: selected.info.provider,
      model: selected.info.model,
      configured: selected.info.configured,
      logFile: logPath(),
    });
    resolve();
  });
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
