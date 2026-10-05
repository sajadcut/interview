import { LLMProviderError } from "./llm-provider.mjs";

export const PERSIAN_PRONUNCIATION_CONTRACT_VERSION = "speech-pronunciation.v1";
export const PERSIAN_PRONUNCIATION_CAPABILITY = "speech.persian_pronunciation";
export const PERSIAN_PRONUNCIATION_CAPABILITY_VERSION = "v1";
export const PERSIAN_PRONUNCIATION_PROMPT_ID = "speech.persian_pronunciation";
export const PERSIAN_PRONUNCIATION_PROMPT_VERSION = "v1";
export const PERSIAN_PRONUNCIATION_SCHEMA_VERSION = "speech-pronunciation.v1";

const MAX_TEXT_CHARS = 4000;

export const persianPronunciationPromptDefinition = Object.freeze({
  id: PERSIAN_PRONUNCIATION_PROMPT_ID,
  version: PERSIAN_PRONUNCIATION_PROMPT_VERSION,
  variables: ["input"],
  system: `You are a Persian pronunciation renderer for text-to-speech. Return only JSON.

Your job is NOT to rewrite, summarize, improve, translate, or change the meaning of the sentence. Produce a speech-only rendering of the supplied spokenText.

Rules:
- Preserve every factual claim, number, question, negation, name, and technical meaning.
- Keep the sentence order and wording as close to the input as possible.
- Add Persian short-vowel marks (َ ِ ُ), tashdid (ّ), sukun (ْ), tanwin, and ezafe markers only where they help a Persian TTS pronounce the sentence correctly.
- Resolve ambiguous Persian pronunciation contextually. Example: "تخصیص" may be rendered "تَخصیص"; "تخصص" may be rendered "تَخَصُّص".
- Make ezafe audible where useful, for example "تجربهٔ کاریِ شما" or "معماریِ سیستم".
- For Latin technical terms that are intended to be spoken, render a natural Persian phonetic pronunciation. Examples: ".NET" -> "دات‌نِت", "SQL" -> "اِس‌کیو‌اِل", "API" -> "اِی پی آی", "Entity Framework" -> "اِنتیتی فِریم‌وِرک".
- Preserve URLs, file paths, commands, code snippets, version numbers, IDs and quoted literals when phonetic rewriting could change their identity.
- Do not add explanations, labels, commentary, model answers, or extra sentences.
- Do not remove content.
- Do not over-diacritize words whose pronunciation is already unambiguous.
- The output is used only for audio synthesis; canonical interview text is stored separately.`,
  user: "Pronunciation input JSON:\n{{input}}",
});

export const persianPronunciationOutputSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["ttsText"],
  properties: {
    ttsText: { type: "string", minLength: 1, maxLength: MAX_TEXT_CHARS },
  },
});

function serializedInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new LLMProviderError("INVALID_REQUEST");
  }
  const spokenText = typeof input.spokenText === "string" ? input.spokenText.trim() : "";
  if (!spokenText || spokenText.length > MAX_TEXT_CHARS || spokenText.includes("\0")) {
    throw new LLMProviderError("INVALID_REQUEST");
  }
  return JSON.stringify({ spokenText, language: "fa" });
}

export async function generatePersianPronunciation({ llm, input, signal, metadata = {} }) {
  if (!llm || typeof llm.generateStructured !== "function") {
    throw new LLMProviderError("INVALID_REQUEST");
  }
  const generated = await llm.generateStructured({
    prompt: {
      id: PERSIAN_PRONUNCIATION_PROMPT_ID,
      version: PERSIAN_PRONUNCIATION_PROMPT_VERSION,
      variables: { input: serializedInput(input) },
    },
    schema: persianPronunciationOutputSchema,
    maxOutputTokens: 1000,
    budget: {
      maxInputTokens: 2500,
      maxOutputTokens: 1200,
      maxTotalTokens: 3700,
      maxCostMicros: 500_000,
    },
    signal,
    metadata: {
      capability: PERSIAN_PRONUNCIATION_CAPABILITY,
      capabilityVersion: PERSIAN_PRONUNCIATION_CAPABILITY_VERSION,
      contractVersion: PERSIAN_PRONUNCIATION_CONTRACT_VERSION,
      ...metadata,
    },
  });

  const ttsText = generated.data.ttsText.trim();
  if (!ttsText || ttsText.length > MAX_TEXT_CHARS) {
    throw new LLMProviderError("STRUCTURED_OUTPUT_INVALID");
  }
  return {
    output: { ttsText },
    provenance: {
      provider: generated.provider,
      ...(generated.model ? { model: generated.model } : {}),
      promptId: generated.prompt.id,
      promptVersion: generated.prompt.version,
      attempts: generated.attempts,
      usage: generated.usage,
    },
  };
}
