import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { getEnv } from "../config/env";
import type { ResumeEmbeddingBatch, ResumeEmbeddingProvider } from "./resume-embedding-provider";

type EmbeddingResponse = {
  model?: unknown;
  data?: Array<{ index?: unknown; embedding?: unknown }>;
};

@Injectable()
export class OpenAiCompatibleResumeEmbeddingProvider implements ResumeEmbeddingProvider {
  get configured(): boolean {
    return getEnv().EMBEDDING_PROVIDER === "openai-compatible";
  }

  async embed(texts: string[]): Promise<ResumeEmbeddingBatch> {
    if (!texts.length) {
      throw new ServiceUnavailableException("Resume embedding input is empty");
    }
    if (texts.length > 64) {
      throw new ServiceUnavailableException("Resume embedding batch exceeds 64 chunks");
    }

    const env = getEnv();
    const apiKey = env.EMBEDDING_API_KEY || env.LLM_API_KEY;
    const baseUrl = (env.EMBEDDING_BASE_URL ?? env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: env.EMBEDDING_MODEL, input: texts, encoding_format: "float" }),
      signal: AbortSignal.timeout(env.EMBEDDING_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ServiceUnavailableException(`Resume embedding provider returned HTTP ${response.status}`);
    }

    let payload: EmbeddingResponse;
    try {
      payload = await response.json() as EmbeddingResponse;
    } catch {
      throw new ServiceUnavailableException("Resume embedding provider returned invalid JSON");
    }
    if (!Array.isArray(payload.data) || payload.data.length !== texts.length) {
      throw new ServiceUnavailableException("Resume embedding provider returned an invalid batch size");
    }

    const ordered = [...payload.data].sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
    const vectors = ordered.map((item) => validateVector(item.embedding));
    const dimensions = vectors[0]?.length ?? 0;
    if (!dimensions || vectors.some((vector) => vector.length !== dimensions)) {
      throw new ServiceUnavailableException("Resume embedding vectors have inconsistent dimensions");
    }

    return {
      provider: "openai-compatible",
      model: typeof payload.model === "string" && payload.model ? payload.model : env.EMBEDDING_MODEL,
      dimensions,
      vectors,
    };
  }
}

function validateVector(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8192) {
    throw new ServiceUnavailableException("Resume embedding provider returned an invalid vector");
  }
  const vector = value.map((entry) => Number(entry));
  if (vector.some((entry) => !Number.isFinite(entry))) {
    throw new ServiceUnavailableException("Resume embedding provider returned a non-finite vector");
  }
  return vector;
}
