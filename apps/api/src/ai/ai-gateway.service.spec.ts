import assert from "node:assert/strict";
import test from "node:test";
import type { AiJobQueueService } from "./ai-job-queue.service";
import {
  AiGatewayService,
  RealtimeAiExecutionError,
  type AiExecutionRequest,
} from "./ai-gateway.service";
import { TenantContextService } from "../tenant/tenant-context.service";

const organizationId = "22222222-2222-4222-8222-222222222222";

function realtimeRequest(): AiExecutionRequest {
  return {
    capability: "interview.next_turn",
    capabilityVersion: "v2",
    promptId: "interview.conversational_next_turn",
    promptVersion: "v1",
    structuredOutputSchemaVersion: "llm-interviewer.v1",
    input: { latestCandidateText: "نتیجه هیچی نشد" },
    inputReferences: { sessionId: "session-1" },
    idempotencyKey: "realtime-interviewer:session-1:1",
  };
}

function gateway() {
  const queue = { enqueue: async () => ({}) } as unknown as AiJobQueueService;
  return new AiGatewayService(queue, new TenantContextService());
}

async function withRealtimeEnvironment(run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const previousSecret = process.env.AI_WORKER_SHARED_SECRET;
  const previousBaseUrl = process.env.AI_INTERVIEWER_BASE_URL;
  const previousTimeout = process.env.AI_INTERVIEWER_REQUEST_TIMEOUT_MS;
  process.env.AI_WORKER_SHARED_SECRET = "test-ai-worker-secret";
  process.env.AI_INTERVIEWER_BASE_URL = "http://127.0.0.1:9040";
  process.env.AI_INTERVIEWER_REQUEST_TIMEOUT_MS = "2000";
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (previousSecret === undefined) delete process.env.AI_WORKER_SHARED_SECRET;
    else process.env.AI_WORKER_SHARED_SECRET = previousSecret;
    if (previousBaseUrl === undefined) delete process.env.AI_INTERVIEWER_BASE_URL;
    else process.env.AI_INTERVIEWER_BASE_URL = previousBaseUrl;
    if (previousTimeout === undefined) delete process.env.AI_INTERVIEWER_REQUEST_TIMEOUT_MS;
    else process.env.AI_INTERVIEWER_REQUEST_TIMEOUT_MS = previousTimeout;
  }
}

test("AI gateway enqueues canonical durable worker work with versioned provenance references", async () => {
  let input: Record<string, unknown> | undefined;
  const queue = {
    enqueue: async (value: Record<string, unknown>) => {
      input = value;
      return { id: "job-1" };
    },
  } as unknown as AiJobQueueService;
  const tenant = new TenantContextService();
  const service = new AiGatewayService(queue, tenant);

  const result = await tenant.run(organizationId, () =>
    service.enqueueStructured({
      capability: "candidate.summary",
      capabilityVersion: "v1",
      promptId: "candidate.summary",
      promptVersion: "v1",
      structuredOutputSchemaVersion: "candidate-summary.v1",
      input: { candidateId: "candidate-1" },
      inputReferences: { candidateId: "candidate-1" },
      idempotencyKey: "candidate-summary:candidate-1:v1",
    }),
  );

  assert.equal((result as unknown as { id: string }).id, "job-1");
  assert.equal(input?.organizationId, organizationId);
  assert.equal(input?.capability, "candidate.summary");
  assert.equal(input?.idempotencyKey, "candidate-summary:candidate-1:v1");
});

test("synchronous execution remains forbidden for non-live AI capabilities", async () => {
  await assert.rejects(
    () => gateway().executeStructured({ ...realtimeRequest(), capability: "candidate.summary" }),
    /restricted to the latency-sensitive interview.next_turn capability/,
  );
});

test("realtime interviewer execution validates contract and returns provenance", async () => {
  await withRealtimeEnvironment(async () => {
    let observedSecret = "";
    globalThis.fetch = async (_url, init) => {
      observedSecret = new Headers(init?.headers).get("x-ai-worker-secret") ?? "";
      return new Response(
        JSON.stringify({
          contractVersion: "llm-interviewer.v1",
          executionId: "execution-1",
          output: {
            action: "probe",
            criterion: "backend_depth",
            objective: "validate backend depth",
            spokenText: "دقیقاً چه چیزی طبق انتظار پیش نرفت؟",
            expectedEvidence: ["outcome"],
            reason: "Probe the ambiguous result.",
          },
          provenance: {
            provider: "openai-compatible",
            model: "test-model",
            promptId: "interview.conversational_next_turn",
            promptVersion: "v1",
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-llm-interviewer-contract-version": "llm-interviewer.v1",
          },
        },
      );
    };
    const result = await gateway().executeStructured<Record<string, unknown>>(realtimeRequest());
    assert.equal(result.executionId, "execution-1");
    assert.equal(result.provenance.provider, "openai-compatible");
    assert.equal(result.provenance.promptVersion, "v1");
    assert.equal(observedSecret, "test-ai-worker-secret");
  });
});

test("realtime provider failures are surfaced as typed safe errors for brain fallback", async () => {
  await withRealtimeEnvironment(async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: { code: "PROVIDER_UNAVAILABLE", message: "LLM provider is unavailable" } }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    await assert.rejects(
      () => gateway().executeStructured(realtimeRequest()),
      (error) => error instanceof RealtimeAiExecutionError && error.code === "PROVIDER_UNAVAILABLE",
    );
  });
});

test("realtime readiness reports reachable provider state without exposing credentials", async () => {
  await withRealtimeEnvironment(async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          service: "llm-interviewer",
          enabled: true,
          configured: true,
          reachable: true,
          ready: true,
          provider: "openai-compatible",
          model: "test-model",
          promptId: "interview.conversational_next_turn",
          promptVersion: "v1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const readiness = await gateway().realtimeReadiness();
    assert.equal(readiness.reachable, true);
    assert.equal(readiness.ready, true);
    assert.equal(readiness.provider, "openai-compatible");
    assert.equal(JSON.stringify(readiness).includes("test-ai-worker-secret"), false);
  });
});

test("reachable sidecar does not make an unreachable LLM provider ready", async () => {
  await withRealtimeEnvironment(async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          service: "llm-interviewer",
          enabled: true,
          configured: true,
          reachable: false,
          ready: false,
          provider: "openai-compatible",
          promptId: "interview.conversational_next_turn",
          promptVersion: "v1",
          reason: "provider_unreachable",
          fallbackAvailable: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const readiness = await gateway().realtimeReadiness();
    assert.equal(readiness.enabled, true);
    assert.equal(readiness.configured, true);
    assert.equal(readiness.reachable, false);
    assert.equal(readiness.ready, false);
    assert.equal(readiness.reason, "provider_unreachable");
  });
});
