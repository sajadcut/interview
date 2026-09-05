import { ConflictException, Injectable } from "@nestjs/common";
import { TenantContextService } from "../tenant/tenant-context.service";
import { AiJobQueueService, type AiJob } from "./ai-job-queue.service";

export const AI_WORKER_CAPABILITIES = [
  "interview.next_turn",
  "interview.evidence_extract",
  "interview.contradiction_detect",
  "interview.evaluate",
  "candidate.resume_enrich",
  "candidate.summary",
  "interview.recommendation_summary",
] as const;

export type AiWorkerCapability = (typeof AI_WORKER_CAPABILITIES)[number];

export interface AiExecutionRequest {
  capability: AiWorkerCapability;
  capabilityVersion: string;
  promptId: string;
  promptVersion: string;
  structuredOutputSchemaVersion: string;
  input: Record<string, unknown>;
  inputReferences: Record<string, unknown>;
  idempotencyKey: string;
  priority?: number;
  maxAttempts?: number;
  timeoutMs?: number;
}

@Injectable()
export class AiGatewayService {
  constructor(
    private readonly queue: AiJobQueueService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async enqueueStructured(request: AiExecutionRequest): Promise<AiJob> {
    if (!AI_WORKER_CAPABILITIES.includes(request.capability)) {
      throw new Error("Unsupported AI worker capability");
    }
    if (!request.capabilityVersion.trim()) throw new Error("AI capability version is required");
    if (!request.promptId.trim() || !request.promptVersion.trim()) throw new Error("AI prompt reference is required");
    if (!request.structuredOutputSchemaVersion.trim()) throw new Error("AI structured-output schema version is required");
    if (!request.idempotencyKey.trim()) throw new Error("AI idempotency key is required");

    const organizationId = this.tenantContext.require().organizationId;
    return this.queue.enqueue({
      organizationId,
      capability: request.capability,
      payload: {
        capabilityVersion: request.capabilityVersion,
        promptId: request.promptId,
        promptVersion: request.promptVersion,
        structuredOutputSchemaVersion: request.structuredOutputSchemaVersion,
        inputReferences: request.inputReferences,
        input: request.input,
      },
      idempotencyKey: request.idempotencyKey,
      ...(request.priority !== undefined ? { priority: request.priority } : {}),
      ...(request.maxAttempts !== undefined ? { maxAttempts: request.maxAttempts } : {}),
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    });
  }

  async executeStructured<T>(request: unknown): Promise<{ executionId: string; output: T }> {
    void request;
    throw new ConflictException(
      "Synchronous LLM execution is disabled. AI capabilities must execute through the durable AI worker queue.",
    );
  }
}
