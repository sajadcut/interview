import assert from "node:assert/strict";
import test from "node:test";
import { resetEnvCacheForTests } from "../config/env";
import { SkillProposalProvider } from "./skill-proposal-provider";

test("LLM skill provider is opt-in, bounded, and fails closed without valid structured output", async () => {
  const old = new Map<string, string | undefined>();
  for (const key of ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL"]) old.set(key, process.env[key]);
  const original = globalThis.fetch;
  const provider = new SkillProposalProvider();
  let calls = 0;
  try {
    process.env.LLM_PROVIDER = "disabled";
    resetEnvCacheForTests();
    globalThis.fetch = async () => { calls++; throw new Error("disabled provider must never call network"); };
    const disabled = await provider.propose({ text: "Redis", skillKeys: ["redis"] });
    assert.equal(disabled.status, "disabled");
    assert.equal(calls, 0);

    process.env.LLM_PROVIDER = "openai-compatible";
    process.env.LLM_MODEL = "mock-model";
    process.env.LLM_API_KEY = "local-test-key";
    process.env.LLM_BASE_URL = "https://example.invalid/v1";
    resetEnvCacheForTests();
    // An enabled provider without an explicit endpoint must never receive resume text.
    delete process.env.LLM_BASE_URL;
    resetEnvCacheForTests();
    assert.equal((await provider.propose({ text: "Private candidate resume", skillKeys: ["redis"] })).status, "unavailable");
    assert.equal(calls, 0);
    process.env.LLM_BASE_URL = "https://example.invalid/v1";
    resetEnvCacheForTests();
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(String(url), "https://example.invalid/v1/chat/completions");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer local-test-key");
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
      };
      assert.equal(body.model, "mock-model");
      assert.equal(body.messages[0]?.role, "system");
      assert.ok(body.messages[1]?.content.includes("Redis"));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        schemaVersion: "skill-proposals.v1",
        proposals: [{ skillKey: "redis", excerpt: "Redis", startChar: 0, endChar: 5, confidence: 0.8 }],
      }) } }] }), { status: 200 });
    };
    const valid = await provider.propose({ text: "Redis", skillKeys: ["redis"] });
    assert.equal(valid.status, "ok");
    if (valid.status === "ok") {
      assert.equal((valid.output as { schemaVersion: string }).schemaVersion, "skill-proposals.v1");
    }
    assert.equal(calls, 1);

    globalThis.fetch = async () => new Response("provider unavailable", { status: 503 });
    assert.equal((await provider.propose({ text: "Redis", skillKeys: ["redis"] })).status, "unavailable");
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: "invalid JSON" } }],
    }), { status: 200 });
    assert.equal((await provider.propose({ text: "Redis", skillKeys: ["redis"] })).status, "unavailable");
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of old) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvCacheForTests();
  }
});
