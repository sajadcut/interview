import assert from "node:assert/strict";
import test from "node:test";
import { createConfiguredProvider } from "../src/provider-factory.mjs";

for (const [name, expected, baseUrl] of [
  ["openai", "openai", "https://api.openai.com/v1"],
  ["deepseek", "deepseek", "https://api.deepseek.com"],
  ["dotin-general-chatbot", "dotin-general-chatbot", "https://aifa-chatbot.dev.dotin.ir/v1"],
]) {
  test(`provider factory configures ${name}`, () => {
    const provider = createConfiguredProvider({
      NODE_ENV: "development",
      LLM_PROVIDER: name,
      LLM_API_KEY: "key",
      LLM_MODEL: "model",
    });
    assert.equal(provider.name, expected);
  });
}

test("provider factory configures gemini", () => {
  const provider = createConfiguredProvider({
    NODE_ENV: "development",
    LLM_PROVIDER: "gemini",
    LLM_API_KEY: "key",
    LLM_MODEL: "gemini-test",
  });
  assert.equal(provider.name, "gemini");
});

test("generic OpenAI-compatible requires an explicit base URL", () => {
  assert.throws(() => createConfiguredProvider({
    LLM_PROVIDER: "openai-compatible",
    LLM_API_KEY: "key",
    LLM_MODEL: "model",
  }), /LLM_BASE_URL/);
});
