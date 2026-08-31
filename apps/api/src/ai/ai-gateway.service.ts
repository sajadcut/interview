import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";
import { DatabaseService } from "../database/database.service";
import { getEnv } from "../config/env";
import { TenantContextService } from "../tenant/tenant-context.service";
import { LLM_PROVIDER, type LlmMessage, type LlmProvider } from "./llm-provider";

export interface AiExecutionRequest<T> {
  capability: string;
  promptVersion: string;
  model?: string;
  messages: LlmMessage[];
  schema: z.ZodType<T>;
  inputReferences?: Record<string, unknown>;
  temperature?: number;
}

export class AiStructuredOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiStructuredOutputError";
  }
}

@Injectable()
export class AiGatewayService {
  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async executeStructured<T>(request: AiExecutionRequest<T>): Promise<{ executionId: string; output: T }> {
    const organizationId = this.tenantContext.require().organizationId;
    const executionId = randomUUID();
    const started = Date.now();
    const model = request.model?.trim() || getEnv().LLM_MODEL.trim();
    if (!model) throw new Error("An LLM model must be supplied by the request or LLM_MODEL");

    await this.database.sql`
      INSERT INTO ai_executions (
        id, organization_id, capability, provider, model, prompt_version, status, input_references
      ) VALUES (
        ${executionId}::uuid,
        ${organizationId}::uuid,
        ${request.capability},
        ${this.provider.name},
        ${model},
        ${request.promptVersion},
        'running',
        ${request.inputReferences ? this.database.sql.json(request.inputReferences as never) : null}
      )
    `;

    try {
      const result = await this.provider.generateStructured({
        model,
        messages: request.messages,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      });
      const parsed = request.schema.safeParse(result.output);
      if (!parsed.success) {
        const details = parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`)
          .join("; ");
        throw new AiStructuredOutputError(`LLM structured output validation failed: ${details}`);
      }

      const latencyMs = Date.now() - started;
      await this.database.sql`
        UPDATE ai_executions SET
          status = 'succeeded',
          structured_output = ${this.database.sql.json(parsed.data as never)},
          prompt_tokens = ${result.promptTokens ?? null},
          completion_tokens = ${result.completionTokens ?? null},
          latency_ms = ${latencyMs},
          completed_at = now()
        WHERE id = ${executionId}::uuid AND organization_id = ${organizationId}::uuid
      `;

      return { executionId, output: parsed.data };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown LLM error";
      await this.database.sql`
        UPDATE ai_executions SET
          status = 'failed',
          error_message = ${message.slice(0, 4000)},
          latency_ms = ${Date.now() - started},
          completed_at = now()
        WHERE id = ${executionId}::uuid AND organization_id = ${organizationId}::uuid
      `;
      throw error;
    }
  }
}
