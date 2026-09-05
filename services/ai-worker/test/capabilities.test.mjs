import assert from "node:assert/strict";
import test from "node:test";
import { capabilityPromptDefinitions, createCapabilityProcessors } from "../src/capabilities.mjs";
import { LLMProviderError, LLMProviderLayer, PromptRegistry } from "../src/llm-provider.mjs";
import { PermanentJobError, RetryableJobError } from "../src/runtime.mjs";

function scriptedLayer(script) {
  const prompts = new PromptRegistry(capabilityPromptDefinitions().map(({ capability: _capability, ...definition }) => definition));
  let index = 0;
  const provider = {
    name: "scripted-ci",
    async generate() {
      const step = script[Math.min(index++, script.length - 1)];
      if (step instanceof Error) throw step;
      return {
        output: step.output,
        model: "scripted-model-v1",
        usage: step.usage ?? { inputTokens: 10, outputTokens: 5, costMicros: 17 },
      };
    },
  };
  return new LLMProviderLayer({ providers: [provider], promptRegistry: prompts, retryInitialDelayMs: 0, retryMaxDelayMs: 0 });
}

const job = { id: "11111111-1111-4111-8111-111111111111" };

for (const capability of [
  "interview.next_turn",
  "interview.evidence_extract",
  "interview.contradiction_detect",
  "interview.evaluate",
  "candidate.resume_enrich",
  "candidate.summary",
  "interview.recommendation_summary",
]) {
  test(`${capability} is registered as a real worker capability`, () => {
    const processors = createCapabilityProcessors({ llm: { generateStructured: async () => ({}) } });
    assert.equal(typeof processors.get(capability), "function");
  });
}

test("next-turn result stores reconstructable prompt/provider/attempt/usage provenance", async () => {
  const llm = scriptedLayer([{ output: JSON.stringify({ action: "ask", criterion: "criterion-1", objective: "assess", spokenText: "Describe your approach.", expectedEvidence: ["example"] }) }]);
  const result = await createCapabilityProcessors({ llm }).get("interview.next_turn")({
    job,
    payload: { capabilityVersion: "v1", input: { sessionId: "s1" }, inputReferences: { interviewSessionId: "s1" } },
    signal: new AbortController().signal,
  });
  assert.equal(result.capabilityVersion, "v1");
  assert.equal(result.provenance.promptId, "interview.next_turn");
  assert.equal(result.provenance.provider, "scripted-ci");
  assert.equal(result.provenance.attempts.length, 1);
  assert.equal(result.provenance.usage.costMicros, 17);
});

test("malformed structured output retries and succeeds without bypassing schema validation", async () => {
  const llm = scriptedLayer([
    { output: "not-json" },
    { output: JSON.stringify({ summary: "Grounded summary", strengthEvidence: [], gapEvidence: [], limitations: [] }) },
  ]);
  const result = await createCapabilityProcessors({ llm }).get("candidate.summary")({
    job,
    payload: { input: { candidateId: "c1" }, inputReferences: { candidateId: "c1" } },
    signal: new AbortController().signal,
  });
  assert.equal(result.output.summary, "Grounded summary");
  assert.equal(result.provenance.attempts.length, 2);
});

test("provider retry exhaustion remains retryable for durable queue dead-letter policy", async () => {
  const llm = scriptedLayer([new LLMProviderError("PROVIDER_UNAVAILABLE", { provider: "scripted-ci" })]);
  await assert.rejects(
    () => createCapabilityProcessors({ llm }).get("candidate.summary")({ job, payload: { input: { candidateId: "c1" } }, signal: new AbortController().signal }),
    RetryableJobError,
  );
});

test("secret-bearing prompt fields are rejected permanently and are never sent to provider", async () => {
  let called = false;
  const processors = createCapabilityProcessors({ llm: { generateStructured: async () => { called = true; return {}; } } });
  await assert.rejects(
    () => processors.get("candidate.summary")({ job, payload: { input: { candidateId: "c1", apiKey: "do-not-send" } }, signal: new AbortController().signal }),
    PermanentJobError,
  );
  assert.equal(called, false);
});

test("unsupported capability version is permanent", async () => {
  const processors = createCapabilityProcessors({ llm: { generateStructured: async () => ({}) } });
  await assert.rejects(
    () => processors.get("interview.evaluate")({ job, payload: { capabilityVersion: "v999", input: {} }, signal: new AbortController().signal }),
    PermanentJobError,
  );
});
