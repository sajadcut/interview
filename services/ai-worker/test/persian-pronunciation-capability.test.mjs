import assert from "node:assert/strict";
import test from "node:test";
import {
  LLMProviderError,
  LLMProviderLayer,
  PromptRegistry,
} from "../src/llm-provider.mjs";
import {
  generatePersianPronunciation,
  persianPronunciationPromptDefinition,
} from "../src/persian-pronunciation-capability.mjs";

function layerWith(output) {
  const provider = {
    name: "scripted",
    async generate() {
      return {
        output,
        usage: { inputTokens: 40, outputTokens: 30, costMicros: 1 },
        model: "scripted-model",
      };
    },
  };
  return new LLMProviderLayer({
    providers: [provider],
    promptRegistry: new PromptRegistry([persianPronunciationPromptDefinition]),
    maxAttemptsPerProvider: 1,
    timeoutMs: 1000,
    retryInitialDelayMs: 0,
  });
}

test("Persian pronunciation renderer returns a TTS-only diacritized form", async () => {
  const result = await generatePersianPronunciation({
    llm: layerWith({
      ttsText: "دَر مورِدِ تَخصیصِ مَنابِع در دات‌نِت توضیح بِدِه.",
    }),
    input: {
      spokenText: "در مورد تخصیص منابع در .NET توضیح بده.",
    },
  });

  assert.equal(
    result.output.ttsText,
    "دَر مورِدِ تَخصیصِ مَنابِع در دات‌نِت توضیح بِدِه.",
  );
  assert.equal(result.provenance.promptId, "speech.persian_pronunciation");
  assert.equal(result.provenance.promptVersion, "v1");
});

test("Persian pronunciation renderer rejects empty input before inference", async () => {
  await assert.rejects(
    () =>
      generatePersianPronunciation({
        llm: layerWith({ ttsText: "unused" }),
        input: { spokenText: "   " },
      }),
    (error) => error instanceof LLMProviderError && error.code === "INVALID_REQUEST",
  );
});
