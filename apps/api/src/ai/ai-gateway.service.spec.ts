import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import type { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import {
  AiGatewayService,
  AiProviderTimeoutError,
  AiStructuredOutputError,
} from "./ai-gateway.service";
import type { LlmProvider } from "./llm-provider";

const organizationId = "22222222-2222-4222-8222-222222222222";

function databaseStub(): DatabaseService {
  const sql = Object.assign(async () => [], { json: (value: unknown) => value });
  return { sql } as unknown as DatabaseService;
}

function providerWith(output: unknown): LlmProvider {
  return {
    name: "test-provider",
    generateStructured: async () => ({ output, promptTokens: 10, completionTokens: 5 }),
  };
}

const outputSchema = z.object({ answer: z.string().min(1) });
const request = {
  capability: "foundation.test",
  promptVersion: "test-v1",
  model: "test-model",
  messages: [{ role: "user" as const, content: "return structured output" }],
  schema: outputSchema,
};

test("AI gateway returns only schema-validated structured output", async () => {
  const tenant = new TenantContextService();
  const gateway = new AiGatewayService(providerWith({ answer: "ok" }), databaseStub(), tenant);
  const result = await tenant.run(organizationId, () => gateway.executeStructured(request));
  assert.deepEqual(result.output, { answer: "ok" });
});

test("AI gateway rejects structurally invalid model output", async () => {
  const tenant = new TenantContextService();
  const gateway = new AiGatewayService(providerWith({ answer: 42 }), databaseStub(), tenant);
  await assert.rejects(
    () => tenant.run(organizationId, () => gateway.executeStructured(request)),
    AiStructuredOutputError,
  );
});

test("AI gateway bounds provider execution with a timeout", async () => {
  const tenant = new TenantContextService();
  const provider: LlmProvider = {
    name: "slow-test-provider",
    generateStructured: async () => new Promise(() => undefined),
  };
  const gateway = new AiGatewayService(provider, databaseStub(), tenant);
  await assert.rejects(
    () =>
      tenant.run(organizationId, () =>
        gateway.executeStructured({ ...request, timeoutMs: 250 }),
      ),
    AiProviderTimeoutError,
  );
});
