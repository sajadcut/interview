import { Injectable } from "@nestjs/common";
import { getEnv } from "../config/env";
import type { GenerateStructuredRequest, GenerateStructuredResult, LlmProvider } from "./llm-provider";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

@Injectable()
export class OpenAiCompatibleLlmProvider implements LlmProvider {
  readonly name = "openai-compatible";

  async generateStructured(request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    const env = getEnv();
    if (!env.LLM_API_KEY) throw new Error("LLM_API_KEY is required");
    const baseUrl = (env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.LLM_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${body.slice(0, 500)}`);
    }

    const result = (await response.json()) as ChatCompletionResponse;
    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM returned no content");

    return {
      output: JSON.parse(content) as unknown,
      ...(result.usage?.prompt_tokens !== undefined
        ? { promptTokens: result.usage.prompt_tokens }
        : {}),
      ...(result.usage?.completion_tokens !== undefined
        ? { completionTokens: result.usage.completion_tokens }
        : {}),
    };
  }
}
