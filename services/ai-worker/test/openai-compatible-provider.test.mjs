import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAiCompatibleProvider } from "../src/openai-compatible-provider.mjs";

function provider() {
  return createOpenAiCompatibleProvider({
    NODE_ENV: "development",
    LLM_API_KEY: "test-provider-key",
    LLM_MODEL: "test-model",
    LLM_BASE_URL: "http://provider.test/v1",
    LLM_USER_ID: "test-user",
    LLM_ENABLE_THINKING: "false",
    LLM_REASONING_EFFORT: "medium",
  });
}

async function withFetch(mock, run) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("openai-compatible readiness uses a non-inference models probe", async () => {
  await withFetch(async (url, init) => {
    assert.equal(String(url), "http://provider.test/v1/models");
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-provider-key");
    assert.equal(init?.body, undefined);
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    assert.deepEqual(await provider().checkReadiness(), { reachable: true, ready: true });
  });
});

test("openai-compatible readiness distinguishes authentication failure from network reachability", async () => {
  await withFetch(async () => new Response("unauthorized", { status: 401 }), async () => {
    assert.deepEqual(await provider().checkReadiness(), {
      reachable: true,
      ready: false,
      reason: "provider_auth_failed",
    });
  });
});

test("openai-compatible readiness reports an unreachable provider without leaking diagnostics", async () => {
  await withFetch(async () => {
    throw new Error("socket error containing sensitive provider details");
  }, async () => {
    const result = await provider().checkReadiness();
    assert.deepEqual(result, {
      reachable: false,
      ready: false,
      reason: "provider_unreachable",
    });
    assert.equal(JSON.stringify(result).includes("socket error"), false);
    assert.equal(JSON.stringify(result).includes("test-provider-key"), false);
  });
});


test("openai-compatible generation matches the Dotin OpenAI-compatible contract", async () => {
  await withFetch(async (url, init) => {
    assert.equal(String(url), "http://provider.test/v1/chat/completions");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-provider-key");
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.get("x-request-id"), "execution-123");
    assert.equal(headers.get("x-session-id"), "session-456");
    assert.equal(headers.get("x-user-id"), "test-user");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "test-model");
    assert.equal(body.enable_thinking, false);
    assert.equal(body.reasoning_effort, "medium");
    assert.equal(body.messages[1].content, "hello");
    return new Response(JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      model: "test-model",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"ok":true}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, async () => {
    const result = await provider().generate({
      prompt: { system: "system", user: "hello" },
      maxOutputTokens: 20,
      metadata: {
        executionId: "execution-123",
        inputReferences: { sessionId: "session-456" },
      },
    });
    assert.equal(result.output, '{"ok":true}');
    assert.equal(result.model, "test-model");
    assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, costMicros: 0 });
  });
});
