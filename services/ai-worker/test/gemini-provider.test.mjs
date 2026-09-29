import assert from "node:assert/strict";
import test from "node:test";
import { createGeminiProvider } from "../src/gemini-provider.mjs";

async function withFetch(mock, run) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = original; }
}

test("gemini uses native generateContent JSON mode", async () => {
  const provider = createGeminiProvider({
    NODE_ENV: "development",
    LLM_API_KEY: "gemini-key",
    LLM_MODEL: "gemini-test",
    LLM_BASE_URL: "http://gemini.test/v1beta",
  });
  await withFetch(async (url, init) => {
    assert.equal(String(url), "http://gemini.test/v1beta/models/gemini-test:generateContent");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-goog-api-key"), "gemini-key");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.contents[0].parts[0].text, "hello");
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "{\"ok\":true}" }] } }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, async () => {
    const result = await provider.generate({
      prompt: { system: "system", user: "hello" },
      maxOutputTokens: 20,
    });
    assert.equal(result.output, "{\"ok\":true}");
    assert.deepEqual(result.usage, { inputTokens: 7, outputTokens: 3, costMicros: 0 });
  });
});
