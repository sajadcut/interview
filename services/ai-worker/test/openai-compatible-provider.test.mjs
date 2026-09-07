import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAiCompatibleProvider } from "../src/openai-compatible-provider.mjs";

function provider() {
  return createOpenAiCompatibleProvider({
    NODE_ENV: "development",
    LLM_API_KEY: "test-provider-key",
    LLM_MODEL: "test-model",
    LLM_BASE_URL: "http://provider.test/v1",
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
