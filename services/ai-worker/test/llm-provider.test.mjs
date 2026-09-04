import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTRACT_VERSION,
  LLMProviderError,
  LLMProviderLayer,
  PromptRegistry,
  parseStructuredOutput,
} from "../src/llm-provider.mjs";

const resultSchema = Object.freeze({
  type: "object",
  required: ["decision", "score"],
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["advance", "reject"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
  },
});

function registry() {
  return new PromptRegistry([
    {
      id: "interview.evaluate",
      version: "v1",
      system: "Evaluate evidence using rubric {{rubric}}.",
      user: "Candidate evidence: {{evidence}}",
      variables: ["rubric", "evidence"],
    },
    {
      id: "interview.evaluate",
      version: "v2",
      system: "Evaluate only grounded evidence with rubric {{rubric}}.",
      user: "Evidence packet: {{evidence}}",
      variables: ["rubric", "evidence"],
    },
  ]);
}

function request(overrides = {}) {
  return {
    prompt: {
      id: "interview.evaluate",
      version: "v2",
      variables: { rubric: "backend-v3", evidence: "candidate explained idempotency" },
    },
    schema: resultSchema,
    maxOutputTokens: 100,
    budget: {
      maxInputTokens: 1000,
      maxOutputTokens: 500,
      maxTotalTokens: 1500,
      maxCostMicros: 100000,
    },
    ...overrides,
  };
}

function scriptedProvider(name, steps) {
  let calls = 0;
  return {
    name,
    get calls() {
      return calls;
    },
    async generate(input) {
      const step = steps[Math.min(calls, steps.length - 1)];
      calls += 1;
      return step(input, calls);
    },
  };
}

const noDelay = async () => {};

test("prompt registry keeps immutable explicit versions and exact variable contracts", () => {
  const prompts = registry();
  const v1 = prompts.render({
    id: "interview.evaluate",
    version: "v1",
    variables: { rubric: "r1", evidence: "e1" },
  });
  const v2 = prompts.render({
    id: "interview.evaluate",
    version: "v2",
    variables: { rubric: "r1", evidence: "e1" },
  });
  assert.notEqual(v1.system, v2.system);
  assert.equal(v2.version, "v2");
  assert.throws(
    () =>
      prompts.render({
        id: "interview.evaluate",
        version: "v2",
        variables: { rubric: "r1", evidence: "e1", surprise: "not allowed" },
      }),
    (error) => error instanceof LLMProviderError && error.code === "PROMPT_VARIABLE_MISMATCH",
  );
  assert.throws(
    () => prompts.render({ id: "interview.evaluate", version: "v9", variables: {} }),
    (error) => error instanceof LLMProviderError && error.code === "UNKNOWN_PROMPT",
  );
});

test("structured output parser accepts only the declared JSON shape", () => {
  assert.deepEqual(
    parseStructuredOutput('{"decision":"advance","score":87}', resultSchema),
    { decision: "advance", score: 87 },
  );
  assert.throws(
    () => parseStructuredOutput('{"decision":"advance","score":87,"hidden":"x"}', resultSchema),
    (error) => error instanceof LLMProviderError && error.code === "STRUCTURED_OUTPUT_INVALID",
  );
});

test("provider layer retries malformed structured output and charges every attempt", async () => {
  const provider = scriptedProvider("primary", [
    async () => ({
      output: '{"decision":"maybe","score":40}',
      usage: { inputTokens: 20, outputTokens: 10, costMicros: 100 },
    }),
    async () => ({
      output: '{"decision":"advance","score":88}',
      usage: { inputTokens: 20, outputTokens: 8, costMicros: 80 },
      model: "fake-primary",
    }),
  ]);
  const layer = new LLMProviderLayer({
    providers: [provider],
    promptRegistry: registry(),
    maxAttemptsPerProvider: 2,
    retryInitialDelayMs: 0,
    sleep: noDelay,
  });

  const result = await layer.generateStructured(request());
  assert.deepEqual(result.data, { decision: "advance", score: 88 });
  assert.equal(result.provider, "primary");
  assert.equal(result.model, "fake-primary");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].code, "STRUCTURED_OUTPUT_INVALID");
  assert.deepEqual(result.usage, {
    inputTokens: 40,
    outputTokens: 18,
    totalTokens: 58,
    costMicros: 180,
  });
});

test("retryable provider failures exhaust the primary then fall back", async () => {
  const primary = scriptedProvider("primary", [
    async () => {
      throw new LLMProviderError("PROVIDER_UNAVAILABLE", {
        retryable: true,
        usage: { inputTokens: 5, outputTokens: 0, costMicros: 10 },
      });
    },
  ]);
  const fallback = scriptedProvider("fallback", [
    async ({ metadata }) => {
      assert.equal(metadata.contractVersion, CONTRACT_VERSION);
      return {
        output: { decision: "reject", score: 25 },
        usage: { inputTokens: 20, outputTokens: 6, costMicros: 60 },
      };
    },
  ]);
  const layer = new LLMProviderLayer({
    providers: [primary, fallback],
    promptRegistry: registry(),
    maxAttemptsPerProvider: 2,
    retryInitialDelayMs: 0,
    sleep: noDelay,
  });

  const result = await layer.generateStructured(request());
  assert.equal(primary.calls, 2);
  assert.equal(fallback.calls, 1);
  assert.equal(result.provider, "fallback");
  assert.equal(result.attempts.length, 3);
  assert.equal(result.usage.costMicros, 80);
});

test("provider timeout aborts the attempt and can fall back without a real model", async () => {
  let primaryAborted = false;
  const primary = {
    name: "slow-primary",
    generate({ signal }) {
      return new Promise(() => {
        signal.addEventListener("abort", () => {
          primaryAborted = true;
        }, { once: true });
      });
    },
  };
  const fallback = scriptedProvider("fallback", [
    async () => ({
      output: '{"decision":"advance","score":91}',
      usage: { inputTokens: 20, outputTokens: 8, costMicros: 75 },
    }),
  ]);
  const layer = new LLMProviderLayer({
    providers: [primary, fallback],
    promptRegistry: registry(),
    timeoutMs: 20,
    maxAttemptsPerProvider: 1,
    sleep: noDelay,
  });

  const result = await layer.generateStructured(request());
  assert.equal(primaryAborted, true);
  assert.equal(result.provider, "fallback");
  assert.equal(result.attempts[0].code, "PROVIDER_TIMEOUT");
});

test("budget preflight rejects oversized prompts before any provider call", async () => {
  const provider = scriptedProvider("primary", [
    async () => {
      throw new Error("must not run");
    },
  ]);
  const layer = new LLMProviderLayer({
    providers: [provider],
    promptRegistry: registry(),
    sleep: noDelay,
  });

  await assert.rejects(
    layer.generateStructured(
      request({
        prompt: {
          id: "interview.evaluate",
          version: "v2",
          variables: { rubric: "r", evidence: "x".repeat(1000) },
        },
        budget: {
          maxInputTokens: 10,
          maxOutputTokens: 100,
          maxTotalTokens: 110,
          maxCostMicros: 1000,
        },
      }),
    ),
    (error) => error instanceof LLMProviderError && error.code === "BUDGET_EXCEEDED",
  );
  assert.equal(provider.calls, 0);
});

test("usage from failed attempts is charged and budget exhaustion blocks further calls", async () => {
  const primary = scriptedProvider("primary", [
    async () => {
      throw new LLMProviderError("PROVIDER_FAILURE", {
        retryable: true,
        usage: { inputTokens: 60, outputTokens: 20, costMicros: 90 },
      });
    },
  ]);
  const fallback = scriptedProvider("fallback", [
    async () => ({
      output: '{"decision":"advance","score":90}',
      usage: { inputTokens: 10, outputTokens: 5, costMicros: 10 },
    }),
  ]);
  const layer = new LLMProviderLayer({
    providers: [primary, fallback],
    promptRegistry: registry(),
    maxAttemptsPerProvider: 1,
    retryInitialDelayMs: 0,
    sleep: noDelay,
  });

  await assert.rejects(
    layer.generateStructured(
      request({
        budget: {
          maxInputTokens: 70,
          maxOutputTokens: 100,
          maxTotalTokens: 200,
          maxCostMicros: 90,
        },
      }),
    ),
    (error) => error instanceof LLMProviderError && error.code === "BUDGET_EXCEEDED",
  );
  assert.equal(primary.calls, 1);
  assert.equal(fallback.calls, 0);
});

test("external abort stops execution without retrying or falling back", async () => {
  const controller = new AbortController();
  const primary = {
    name: "primary",
    async generate({ signal }) {
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve({
          output: '{"decision":"advance","score":90}',
          usage: { inputTokens: 1, outputTokens: 1, costMicros: 1 },
        }), { once: true });
      });
    },
  };
  const fallback = scriptedProvider("fallback", [
    async () => ({
      output: '{"decision":"reject","score":1}',
      usage: { inputTokens: 1, outputTokens: 1, costMicros: 1 },
    }),
  ]);
  const layer = new LLMProviderLayer({
    providers: [primary, fallback],
    promptRegistry: registry(),
    timeoutMs: 200,
    maxAttemptsPerProvider: 2,
    retryInitialDelayMs: 0,
    sleep: noDelay,
  });
  setTimeout(() => controller.abort(), 10);

  await assert.rejects(
    layer.generateStructured(request({ signal: controller.signal })),
    (error) => error instanceof LLMProviderError && error.code === "REQUEST_ABORTED",
  );
  assert.equal(fallback.calls, 0);
});

test("invalid provider usage is a fail-closed permanent accounting error", async () => {
  const provider = scriptedProvider("primary", [
    async () => ({
      output: '{"decision":"advance","score":90}',
      usage: { inputTokens: 10, outputTokens: -1, costMicros: 1 },
    }),
  ]);
  const layer = new LLMProviderLayer({
    providers: [provider],
    promptRegistry: registry(),
    sleep: noDelay,
  });

  await assert.rejects(
    layer.generateStructured(request()),
    (error) => error instanceof LLMProviderError && error.code === "USAGE_INVALID",
  );
  assert.equal(provider.calls, 1);
});
