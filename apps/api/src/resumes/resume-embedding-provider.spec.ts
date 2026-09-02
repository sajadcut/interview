import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiCompatibleResumeEmbeddingProvider } from "./openai-compatible-resume-embedding.provider";

test("openai-compatible resume embeddings validate and preserve provider vectors", async () => {
  process.env.EMBEDDING_PROVIDER = "openai-compatible";
  process.env.EMBEDDING_MODEL = "embedding-test-model";
  process.env.EMBEDDING_API_KEY = "test-key";
  process.env.EMBEDDING_BASE_URL = "https://embedding.example.invalid/v1";
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({
      model: "embedding-test-model",
      data: [
        { index: 1, embedding: [0.4, 0.5, 0.6] },
        { index: 0, embedding: [0.1, 0.2, 0.3] },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const provider = new OpenAiCompatibleResumeEmbeddingProvider();
    assert.equal(provider.configured, true);
    const result = await provider.embed(["first chunk", "second chunk"]);
    assert.equal(result.provider, "openai-compatible");
    assert.equal(result.model, "embedding-test-model");
    assert.equal(result.dimensions, 3);
    assert.deepEqual(result.vectors, [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);
    assert.deepEqual(requestBody, {
      model: "embedding-test-model",
      input: ["first chunk", "second chunk"],
      encoding_format: "float",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
