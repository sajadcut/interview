import { LLMProviderError } from "./llm-provider.mjs";

function boundedNonNegativeInteger(value) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function endpointFromEnvironment(env) {
  const raw = (env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const url = new URL(raw);
  const production = (env.NODE_ENV ?? "development") === "production";
  if (production && url.protocol !== "https:") {
    throw new Error("Production LLM_BASE_URL must use HTTPS");
  }
  if (!production && !["https:", "http:"].includes(url.protocol)) {
    throw new Error("LLM_BASE_URL must use HTTP(S)");
  }
  return raw;
}

function costMicros(env, inputTokens, outputTokens) {
  const inputRate = boundedNonNegativeInteger(env.LLM_INPUT_COST_MICROS_PER_MILLION_TOKENS);
  const outputRate = boundedNonNegativeInteger(env.LLM_OUTPUT_COST_MICROS_PER_MILLION_TOKENS);
  return Math.ceil((inputTokens * inputRate + outputTokens * outputRate) / 1_000_000);
}

export function createOpenAiCompatibleProvider(env = process.env) {
  const apiKey = env.LLM_API_KEY?.trim();
  const model = env.LLM_MODEL?.trim();
  if (!apiKey) throw new Error("LLM_API_KEY is required for openai-compatible worker provider");
  if (!model) throw new Error("LLM_MODEL is required for openai-compatible worker provider");
  const baseUrl = endpointFromEnvironment(env);

  return {
    name: "openai-compatible",
    async generate({ prompt, maxOutputTokens, signal }) {
      let response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          signal,
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
            temperature: 0.2,
            max_tokens: maxOutputTokens,
            response_format: { type: "json_object" },
          }),
        });
      } catch (error) {
        if (signal?.aborted) throw new LLMProviderError("REQUEST_ABORTED", { provider: "openai-compatible" });
        throw new LLMProviderError("PROVIDER_UNAVAILABLE", { provider: "openai-compatible" });
      }

      if (!response.ok) {
        const code = response.status === 408 || response.status === 429 || response.status >= 500
          ? "PROVIDER_UNAVAILABLE"
          : "PROVIDER_FAILURE";
        throw new LLMProviderError(code, { provider: "openai-compatible" });
      }

      let result;
      try {
        result = await response.json();
      } catch {
        throw new LLMProviderError("PROVIDER_FAILURE", { provider: "openai-compatible" });
      }
      const content = result?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new LLMProviderError("PROVIDER_FAILURE", { provider: "openai-compatible" });
      }
      const inputTokens = boundedNonNegativeInteger(result?.usage?.prompt_tokens);
      const outputTokens = boundedNonNegativeInteger(result?.usage?.completion_tokens);
      return {
        output: content,
        model: typeof result?.model === "string" && result.model ? result.model : model,
        usage: {
          inputTokens,
          outputTokens,
          costMicros: costMicros(env, inputTokens, outputTokens),
        },
      };
    },
  };
}

export function createUnavailableProvider() {
  return {
    name: "disabled",
    async generate() {
      throw new LLMProviderError("PROVIDER_UNAVAILABLE", { provider: "disabled" });
    },
  };
}
