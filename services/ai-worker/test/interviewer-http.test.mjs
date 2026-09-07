import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { LLMProviderError } from "../src/llm-provider.mjs";
import { createInterviewerHttpServer } from "../src/interviewer-http.mjs";

const secret = "test-shared-secret";

function validEnvelope() {
  return {
    contractVersion: "llm-interviewer.v1",
    capability: "interview.next_turn",
    capabilityVersion: "v2",
    promptId: "interview.conversational_next_turn",
    promptVersion: "v2",
    structuredOutputSchemaVersion: "llm-interviewer.v1",
    input: { latestCandidateText: "نتیجه هیچی نشد" },
    inputReferences: { sessionId: "session-1" },
  };
}

async function withServer(
  llm,
  run,
  info = { provider: "fake", model: "fake-1", enabled: true, configured: true },
  providerReadiness = async () => ({ reachable: true, ready: true }),
) {
  const server = createInterviewerHttpServer({
    llm,
    sharedSecret: secret,
    providerInfo: info,
    providerReadiness,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function successfulLlm() {
  return {
    async generateStructured() {
      return {
        data: {
          action: "probe",
          criterion: "backend_depth",
          objective: "validate backend depth",
          spokenText: "وقتی می‌گید نتیجه‌ای نگرفتید، دقیقاً چه چیزی طبق انتظار پیش نرفت؟",
          expectedEvidence: ["outcome"],
          reason: "Probe the ambiguous result.",
        },
        provider: "fake",
        model: "fake-1",
        prompt: { id: "interview.conversational_next_turn", version: "v2" },
        attempts: [],
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, costMicros: 0 },
      };
    },
  };
}

test("realtime interviewer health exposes provider reachability without credentials", async () => {
  await withServer(successfulLlm(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reachable, true);
    assert.equal(body.ready, true);
    assert.equal(body.provider, "fake");
    assert.equal(body.promptVersion, "v2");
    assert.equal(body.fallbackAvailable, true);
    assert.equal(JSON.stringify(body).includes(secret), false);
  });
});

test("configured sidecar reports provider unreachable instead of a false-ready health", async () => {
  let probes = 0;
  await withServer(
    successfulLlm(),
    async (baseUrl) => {
      const first = await fetch(`${baseUrl}/health`);
      const firstBody = await first.json();
      assert.equal(firstBody.enabled, true);
      assert.equal(firstBody.configured, true);
      assert.equal(firstBody.reachable, false);
      assert.equal(firstBody.ready, false);
      assert.equal(firstBody.reason, "provider_unreachable");
      assert.equal(firstBody.fallbackAvailable, true);

      const second = await fetch(`${baseUrl}/health`);
      const secondBody = await second.json();
      assert.equal(secondBody.ready, false);
      assert.equal(probes, 1, "provider readiness should be cached to avoid repeated health traffic");
    },
    undefined,
    async () => {
      probes += 1;
      return { reachable: false, ready: false, reason: "provider_unreachable" };
    },
  );
});

test("realtime interviewer rejects unauthenticated execution", async () => {
  await withServer(successfulLlm(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/interview/next-turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validEnvelope()),
    });
    assert.equal(response.status, 401);
  });
});

test("realtime interviewer returns structured output and provenance", async () => {
  await withServer(successfulLlm(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/interview/next-turn`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-worker-secret": secret,
      },
      body: JSON.stringify(validEnvelope()),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-llm-interviewer-contract-version"), "llm-interviewer.v1");
    const body = await response.json();
    assert.equal(body.output.action, "probe");
    assert.equal(body.provenance.provider, "fake");
    assert.equal(body.provenance.promptVersion, "v2");
    assert.ok(body.executionId);
  });
});

test("realtime interviewer maps provider failures to safe errors", async () => {
  const llm = {
    async generateStructured() {
      throw new LLMProviderError("PROVIDER_UNAVAILABLE", { provider: "fake" });
    },
  };
  await withServer(llm, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/interview/next-turn`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-worker-secret": secret,
      },
      body: JSON.stringify(validEnvelope()),
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.deepEqual(body.error, {
      code: "PROVIDER_UNAVAILABLE",
      message: "LLM provider is unavailable",
    });
  });
});
