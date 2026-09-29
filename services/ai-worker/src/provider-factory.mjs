import { createOpenAiCompatibleProvider, createUnavailableProvider } from "./openai-compatible-provider.mjs";
import { createGeminiProvider } from "./gemini-provider.mjs";

const DEFAULTS = Object.freeze({
  openai: { baseUrl: "https://api.openai.com/v1" },
  deepseek: { baseUrl: "https://api.deepseek.com" },
  "dotin-general-chatbot": { baseUrl: "https://aifa-chatbot.dev.dotin.ir/v1" },
  "openai-compatible": { baseUrl: null },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
});

function mergedEnv(env, overrides) {
  return { ...env, ...overrides };
}

export function createConfiguredProvider(env = process.env) {
  const selected = String(env.LLM_PROVIDER ?? "disabled").trim().toLowerCase();
  if (selected === "disabled") return createUnavailableProvider();

  if (selected === "gemini") {
    return createGeminiProvider(mergedEnv(env, {
      LLM_BASE_URL: env.LLM_BASE_URL?.trim() || DEFAULTS.gemini.baseUrl,
      LLM_PROVIDER_NAME: "gemini",
    }));
  }

  if (["openai", "deepseek", "dotin-general-chatbot", "openai-compatible"].includes(selected)) {
    const baseUrl = env.LLM_BASE_URL?.trim() || DEFAULTS[selected].baseUrl;
    if (!baseUrl) throw new Error("LLM_BASE_URL is required when LLM_PROVIDER=openai-compatible");
    return createOpenAiCompatibleProvider(mergedEnv(env, {
      LLM_BASE_URL: baseUrl,
      LLM_PROVIDER_NAME: selected,
      LLM_DOTIN_METADATA: selected === "dotin-general-chatbot" ? "true" : "false",
    }));
  }

  throw new Error(`Unsupported LLM_PROVIDER ${selected}`);
}

export function providerInfoFromEnvironment(env = process.env) {
  const provider = String(env.LLM_PROVIDER ?? "disabled").trim().toLowerCase();
  const enabled = provider !== "disabled";
  const configured = !enabled || Boolean(env.LLM_API_KEY?.trim() && env.LLM_MODEL?.trim());
  return {
    provider,
    model: env.LLM_MODEL?.trim() || null,
    enabled,
    configured: enabled && configured,
  };
}
