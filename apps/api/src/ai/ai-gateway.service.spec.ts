import assert from "node:assert/strict";
import test from "node:test";
import type { AiJobQueueService } from "./ai-job-queue.service";
import { AiGatewayService } from "./ai-gateway.service";
import { TenantContextService } from "../tenant/tenant-context.service";

const organizationId = "22222222-2222-4222-8222-222222222222";

test("AI gateway enqueues canonical durable worker work with versioned provenance references", async () => {
  let input: Record<string, unknown> | undefined;
  const queue = {
    enqueue: async (value: Record<string, unknown>) => {
      input = value;
      return { id: "job-1" };
    },
  } as unknown as AiJobQueueService;
  const tenant = new TenantContextService();
  const gateway = new AiGatewayService(queue, tenant);

  const result = await tenant.run(organizationId, () =>
    gateway.enqueueStructured({
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

test("legacy synchronous LLM execution fails closed", async () => {
  const queue = { enqueue: async () => ({}) } as unknown as AiJobQueueService;
  const tenant = new TenantContextService();
  const gateway = new AiGatewayService(queue, tenant);
  await assert.rejects(() => gateway.executeStructured({}), /Synchronous LLM execution is disabled/);
});
