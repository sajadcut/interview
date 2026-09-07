import assert from "node:assert/strict";
import test from "node:test";
import {
  LLMProviderError,
  LLMProviderLayer,
  PromptRegistry,
} from "../src/llm-provider.mjs";
import {
  generateConversationalInterviewTurn,
  interviewerPromptDefinition,
  serializeInterviewerInput,
} from "../src/interviewer-capability.mjs";

function context(latestCandidateText = "نتیجه هیچی نشد") {
  return {
    sessionId: "11111111-1111-4111-8111-111111111111",
    sequence: 1,
    language: "fa",
    latestCandidateText,
    candidateIntent: "ANSWER",
    currentCriterion: "backend_depth",
    remainingSeconds: 1200,
    criteria: [
      {
        key: "backend_depth",
        label: "Backend engineering",
        spokenLabel: "مهندسی بک‌اند",
        objective: "validate production backend depth",
        expectedEvidence: ["technical decision", "trade-offs", "measurable outcome"],
        minimumEvidence: 1,
        evidenceCount: 0,
      },
    ],
    evidenceGaps: ["backend_depth"],
    recentTranscript: [
      { speaker: "interviewer", text: "درباره یک تجربه واقعی بک‌اند توضیح دهید." },
      { speaker: "candidate", text: latestCandidateText },
    ],
    job: { title: "Senior Backend Engineer", requirements: [] },
    plan: { version: 1, interviewType: "structured", timeBudgetMinutes: 30 },
    deterministicRecommendation: {
      action: "probe",
      criterion: "backend_depth",
      objective: "validate production backend depth",
      expectedEvidence: ["technical decision"],
    },
    closeObjectives: ["respect_time_budget", "complete_evidence_coverage"],
  };
}

function layerWith(provider, options = {}) {
  return new LLMProviderLayer({
    providers: [provider],
    promptRegistry: new PromptRegistry([interviewerPromptDefinition]),
    maxAttemptsPerProvider: options.maxAttemptsPerProvider ?? 1,
    timeoutMs: options.timeoutMs ?? 1000,
    retryInitialDelayMs: 0,
    sleep: async () => {},
  });
}

test("Persian conversational interviewer reacts to the candidate instead of returning the old probe template", async () => {
  const spokenText = "وقتی می‌گید نتیجه‌ای نگرفتید، تغییر فنی اثر نکرد یا پروژه به اجرا نرسید؟ بعدش چه تصمیمی گرفتید؟";
  const provider = {
    name: "scripted-openai-compatible",
    async generate() {
      return {
        output: JSON.stringify({
          action: "probe",
          criterion: "backend_depth",
          objective: "validate production backend depth",
          spokenText,
          expectedEvidence: ["technical decision"],
          reason: "The candidate gave an ambiguous outcome, so probe the failure and next decision.",
        }),
        usage: { inputTokens: 180, outputTokens: 55, costMicros: 10 },
        model: "scripted-model",
      };
    },
  };

  const result = await generateConversationalInterviewTurn({
    llm: layerWith(provider),
    input: context(),
  });
  assert.equal(result.output.spokenText, spokenText);
  assert.match(result.output.spokenText, /نتیجه|تغییر فنی/);
  assert.doesNotMatch(result.output.spokenText, /ممنون\. برای ارزیابی دقیق‌تر/);
  assert.equal(result.provenance.provider, "scripted-openai-compatible");
  assert.equal(result.provenance.promptId, "interview.conversational_next_turn");
  assert.equal(result.provenance.promptVersion, "v1");
});

test("technical follow-up can stay anchored on a concrete Redis choice", async () => {
  const provider = {
    name: "scripted",
    async generate() {
      return {
        output: {
          action: "probe",
          criterion: "backend_depth",
          objective: "validate production backend depth",
          spokenText: "چرا Redis را انتخاب کردید؟ قبلش indexing یا روش دیگری برای caching را بررسی کرده بودید؟",
          expectedEvidence: ["trade-offs"],
          reason: "Probe the concrete technical choice and alternatives mentioned by the candidate.",
        },
        usage: { inputTokens: 180, outputTokens: 48, costMicros: 8 },
      };
    },
  };
  const result = await generateConversationalInterviewTurn({
    llm: layerWith(provider),
    input: context("Latency پایین نیومد، Redis اضافه کردیم"),
  });
  assert.match(result.output.spokenText, /Redis/);
  assert.match(result.output.spokenText, /indexing|caching/);
});

test("invalid structured interviewer output fails closed", async () => {
  const provider = {
    name: "broken",
    async generate() {
      return {
        output: { action: "probe", spokenText: "missing required fields" },
        usage: { inputTokens: 10, outputTokens: 5, costMicros: 1 },
      };
    },
  };
  await assert.rejects(
    generateConversationalInterviewTurn({ llm: layerWith(provider), input: context() }),
    (error) => error instanceof LLMProviderError && error.code === "STRUCTURED_OUTPUT_INVALID",
  );
});

test("provider timeout remains a safe typed failure for deterministic fallback", async () => {
  const provider = {
    name: "slow",
    async generate() {
      return new Promise(() => {});
    },
  };
  await assert.rejects(
    generateConversationalInterviewTurn({
      llm: layerWith(provider, { timeoutMs: 20 }),
      input: context(),
    }),
    (error) => error instanceof LLMProviderError && error.code === "PROVIDER_TIMEOUT",
  );
});

test("interviewer input rejects secret-bearing keys before prompt rendering", () => {
  assert.throws(
    () => serializeInterviewerInput({ ...context(), apiKey: "must-never-enter-prompt" }),
    (error) => error instanceof LLMProviderError && error.code === "INVALID_REQUEST",
  );
});
