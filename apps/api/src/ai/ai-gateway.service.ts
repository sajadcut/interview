import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { LLM_PROVIDER, type LlmMessage, type LlmProvider } from "./llm-provider";

export interface AiExecutionRequest {
  capability: string;
  promptVersion: string;
  model: string;
  messages: LlmMessage[];
  inputReferences?: Record<string, unknown>;
  temperature?: number;
}

@Injectable()
export class AiGatewayService {
  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async executeStructured<T>(request: AiExecutionRequest): Promise<{ executionId: string; output: T }> {
    const organizationId = this.tenantContext.require().organizationId;
    const executionId = randomUUID();
    const started = Date.now();

    await this.database.sql`
      INSERT INTO ai_executions (
        id, organization_id, capability, provider, model, prompt_version, status, input_references
      ) VALUES (
        ${executionId}::uuid,
        ${organizationId}::uuid,
        ${request.capability},
        ${this.provider.name},
        ${request.model},
        ${request.promptVersion},
        'running',
        ${request.inputReferences ? this.database.sql.json(request.inputReferences as never) : null}
      )
    `;

    try {
      const result = await this.provider.generateStructured({
        model: request.model,
        messages: request.messages,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      });
      const latencyMs = Date.now() - started;

      await this.database.sql`
        UPDATE ai_executions SET
          status = 'succeeded',
          structured_output = ${this.database.sql.json(result.output as never)},
          prompt_tokens = ${result.promptTokens ?? null},
          completion_tokens = ${result.completionTokens ?? null},
          latency_ms = ${latencyMs},
          completed_at = now()
        WHERE id = ${executionId}::uuid AND organization_id = ${organizationId}::uuid
      `;

      return { executionId, output: result.output as T };
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
