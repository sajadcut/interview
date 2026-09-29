import { LLMProviderError } from "./llm-provider.mjs";

function boundedNonNegativeInteger(value) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function endpointFromEnvironment(env) {
  const raw = String(env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const url = new URL(raw);
  const production = (env.NODE_ENV ?? "development") === "production";
  if (production && url.protocol !== "https:") throw new Error("Production LLM_BASE_URL must use HTTPS");
  if (!production && !["https:", "http:"].includes(url.protocol)) throw new Error("LLM_BASE_URL must use HTTP(S)");
  return raw;
}

function costMicros(env, inputTokens, outputTokens) {
  const inputRate = boundedNonNegativeInteger(env.LLM_INPUT_COST_MICROS_PER_MILLION_TOKENS);
  const outputRate = boundedNonNegativeInteger(env.LLM_OUTPUT_COST_MICROS_PER_MILLION_TOKENS);
  return Math.ceil((inputTokens * inputRate + outputTokens * outputRate) / 1_000_000);
}

export function createGeminiProvider(env = process.env) {
  const apiKey = env.LLM_API_KEY?.trim();
  const model = env.LLM_MODEL?.trim();
  if (!apiKey) throw new Error("LLM_API_KEY is required for gemini worker provider");
  if (!model) throw new Error("LLM_MODEL is required for gemini worker provider");
  const baseUrl = endpointFromEnvironment(env);

  return {
    name: "gemini",
    async checkReadiness({ signal } = {}) {
      try {
        const response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}`, {
          headers: { "x-goog-api-key": apiKey, accept: "application/json" },
          signal,
          cache: "no-store",
          redirect: "manual",
        });
        if (response.status === 401 || response.status === 403) {
          return { reachable: true, ready: false, reason: "provider_auth_failed" };
        }
        if (!response.ok) return { reachable: true, ready: false, reason: "provider_not_ready" };
        return { reachable: true, ready: true };
      } catch {
        return { reachable: false, ready: false, reason: "provider_unreachable" };
      }
    },
    async generate({ prompt, maxOutputTokens, signal }) {
      let response;
      try {
        response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: {
            "x-goog-api-key": apiKey,
            "content-type": "application/json",
          },
          signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: prompt.system }] },
            contents: [{ role: "user", parts: [{ text: prompt.user }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens,
              responseMimeType: "application/json",
            },
          }),
        });
      } catch {
        if (signal?.aborted) throw new LLMProviderError("REQUEST_ABORTED", { provider: "gemini" });
        throw new LLMProviderError("PROVIDER_UNAVAILABLE", { provider: "gemini" });
      }
      if (!response.ok) {
        const code = response.status === 408 || response.status === 429 || response.status >= 500
          ? "PROVIDER_UNAVAILABLE"
          : "PROVIDER_FAILURE";
        throw new LLMProviderError(code, { provider: "gemini" });
      }
      let result;
      try { result = await response.json(); }
      catch { throw new LLMProviderError("PROVIDER_FAILURE", { provider: "gemini" }); }
      const content = result?.candidates?.[0]?.content?.parts?.map((p) => p?.text ?? "").join("").trim();
      if (!content) throw new LLMProviderError("PROVIDER_FAILURE", { provider: "gemini" });
      const inputTokens = boundedNonNegativeInteger(result?.usageMetadata?.promptTokenCount);
      const outputTokens = boundedNonNegativeInteger(result?.usageMetadata?.candidatesTokenCount);
      return {
        output: content,
        model,
        usage: {
          inputTokens,
          outputTokens,
          costMicros: costMicros(env, inputTokens, outputTokens),
        },
      };
    },
  };
}
