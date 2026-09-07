#!/usr/bin/env node
import process from "node:process";
import { interviewerPromptDefinition } from "./interviewer-capability.mjs";
import { createInterviewerHttpServer } from "./interviewer-http.mjs";
import { LLMProviderLayer, PromptRegistry } from "./llm-provider.mjs";
import { createOpenAiCompatibleProvider, createUnavailableProvider } from "./openai-compatible-provider.mjs";

function integerEnv(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function providerFromEnvironment() {
  const selected = (process.env.LLM_PROVIDER ?? "disabled").trim().toLowerCase();
  if (selected === "openai-compatible") {
    const configured = Boolean(process.env.LLM_API_KEY?.trim() && process.env.LLM_MODEL?.trim());
    const provider = configured ? createOpenAiCompatibleProvider(process.env) : createUnavailableProvider();
    return {
      provider,
      info: {
        provider: "openai-compatible",
        model: process.env.LLM_MODEL?.trim() || null,
        enabled: true,
        configured,
      },
    };
  }
  if (selected === "disabled") {
    return {
      provider: createUnavailableProvider(),
      info: { provider: "disabled", model: null, enabled: false, configured: false },
    };
  }
  throw new Error(`Unsupported LLM_PROVIDER ${selected}`);
}

const sharedSecret = process.env.AI_WORKER_SHARED_SECRET?.trim();
if (!sharedSecret) throw new Error("AI_WORKER_SHARED_SECRET is required");

const selected = providerFromEnvironment();
const promptRegistry = new PromptRegistry([interviewerPromptDefinition]);
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
    console.log(`Realtime LLM interviewer listening on http://${host}:${port}`);
    console.log(`Provider: ${selected.info.provider}; configured=${selected.info.configured}`);
    resolve();
  });
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
