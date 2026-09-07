import { ConflictException, Injectable, ServiceUnavailableException } from "@nestjs/common";
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

export interface AiRealtimeProvenance {
  provider: string;
  model?: string;
  promptId: string;
  promptVersion: string;
  attempts?: unknown;
  usage?: unknown;
}

export interface AiRealtimeReadiness {
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  ready: boolean;
  provider: string;
  model?: string;
  promptId?: string;
  promptVersion?: string;
  reason?: string;
}

export class RealtimeAiExecutionError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly httpStatus: number | undefined;

  constructor(code: string, options: { retryable: boolean; httpStatus?: number }) {
    super(`Realtime AI execution failed: ${code}`);
    this.name = "RealtimeAiExecutionError";
    this.code = code;
    this.retryable = options.retryable;
    this.httpStatus = options.httpStatus;
  }
}

const LLM_INTERVIEWER_CONTRACT_VERSION = "llm-interviewer.v1";
const MAX_REALTIME_RESPONSE_BYTES = 64 * 1024;

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function realtimeConfiguration() {
  const baseUrl = (process.env.AI_INTERVIEWER_BASE_URL ?? "http://127.0.0.1:9040").trim();
  let normalized: string;
  try {
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported protocol");
    normalized = url.toString().replace(/\/$/, "");
  } catch {
    throw new ServiceUnavailableException("Realtime LLM interviewer URL is invalid");
  }
  return {
    baseUrl: normalized,
    sharedSecret: process.env.AI_WORKER_SHARED_SECRET?.trim() ?? "",
    timeoutMs: boundedInteger(process.env.AI_INTERVIEWER_REQUEST_TIMEOUT_MS, 12_000, 500, 30_000),
  };
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REALTIME_RESPONSE_BYTES) {
    throw new RealtimeAiExecutionError("invalid_response", { retryable: false, httpStatus: response.status });
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_REALTIME_RESPONSE_BYTES) {
    throw new RealtimeAiExecutionError("invalid_response", { retryable: false, httpStatus: response.status });
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid response");
    return parsed as Record<string, unknown>;
  } catch {
    throw new RealtimeAiExecutionError("invalid_response", { retryable: false, httpStatus: response.status });
  }
}

function providerFailure(payload: Record<string, unknown>, status: number): RealtimeAiExecutionError {
  const raw = payload.error;
  const error = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const code = typeof error.code === "string" && error.code.trim() ? error.code.trim() : `http_${status}`;
  const retryable = status === 408 || status === 429 || status >= 500;
  return new RealtimeAiExecutionError(code, { retryable, httpStatus: status });
}

function validateExecutionRequest(request: AiExecutionRequest): void {
  if (!AI_WORKER_CAPABILITIES.includes(request.capability)) throw new Error("Unsupported AI worker capability");
  if (!request.capabilityVersion.trim()) throw new Error("AI capability version is required");
  if (!request.promptId.trim() || !request.promptVersion.trim()) throw new Error("AI prompt reference is required");
  if (!request.structuredOutputSchemaVersion.trim()) throw new Error("AI structured-output schema version is required");
  if (!request.idempotencyKey.trim()) throw new Error("AI idempotency key is required");
}

@Injectable()
export class AiGatewayService {
  constructor(
    private readonly queue: AiJobQueueService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async enqueueStructured(request: AiExecutionRequest): Promise<AiJob> {
    validateExecutionRequest(request);
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

  async executeStructured<T>(
    request: AiExecutionRequest,
  ): Promise<{ executionId: string; output: T; provenance: AiRealtimeProvenance }> {
    validateExecutionRequest(request);
    if (request.capability !== "interview.next_turn") {
      throw new ConflictException(
        "Synchronous LLM execution is restricted to the latency-sensitive interview.next_turn capability",
      );
    }

    const config = realtimeConfiguration();
    if (!config.sharedSecret) {
      throw new RealtimeAiExecutionError("not_configured", { retryable: false });
    }

    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/v1/interview/next-turn`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-ai-worker-secret": config.sharedSecret,
          "x-llm-interviewer-contract-version": LLM_INTERVIEWER_CONTRACT_VERSION,
        },
        body: JSON.stringify({
          contractVersion: LLM_INTERVIEWER_CONTRACT_VERSION,
          capability: request.capability,
          capabilityVersion: request.capabilityVersion,
          promptId: request.promptId,
          promptVersion: request.promptVersion,
          structuredOutputSchemaVersion: request.structuredOutputSchemaVersion,
          input: request.input,
          inputReferences: request.inputReferences,
          idempotencyKey: request.idempotencyKey,
        }),
        signal: AbortSignal.timeout(request.timeoutMs ?? config.timeoutMs),
        cache: "no-store",
        redirect: "manual",
      });
    } catch (cause) {
      const timeout =
        (cause instanceof DOMException && ["TimeoutError", "AbortError"].includes(cause.name)) ||
        (cause instanceof Error && /timeout/i.test(cause.name));
      throw new RealtimeAiExecutionError(timeout ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE", {
        retryable: true,
      });
    }

    const payload = await boundedJson(response);
    if (!response.ok) throw providerFailure(payload, response.status);
    if (
      response.headers.get("x-llm-interviewer-contract-version") !== LLM_INTERVIEWER_CONTRACT_VERSION ||
      payload.contractVersion !== LLM_INTERVIEWER_CONTRACT_VERSION ||
      typeof payload.executionId !== "string" ||
      !payload.executionId.trim() ||
      !payload.output ||
      typeof payload.output !== "object" ||
      Array.isArray(payload.output) ||
      !payload.provenance ||
      typeof payload.provenance !== "object" ||
      Array.isArray(payload.provenance)
    ) {
      throw new RealtimeAiExecutionError("invalid_response", { retryable: false, httpStatus: response.status });
    }
    const provenance = payload.provenance as Record<string, unknown>;
    if (
      typeof provenance.provider !== "string" ||
      typeof provenance.promptId !== "string" ||
      typeof provenance.promptVersion !== "string"
    ) {
      throw new RealtimeAiExecutionError("invalid_response", { retryable: false, httpStatus: response.status });
    }
    return {
      executionId: payload.executionId,
      output: payload.output as T,
      provenance: {
        provider: provenance.provider,
        ...(typeof provenance.model === "string" ? { model: provenance.model } : {}),
        promptId: provenance.promptId,
        promptVersion: provenance.promptVersion,
        ...(provenance.attempts !== undefined ? { attempts: provenance.attempts } : {}),
        ...(provenance.usage !== undefined ? { usage: provenance.usage } : {}),
      },
    };
  }

  async realtimeReadiness(): Promise<AiRealtimeReadiness> {
    let config: ReturnType<typeof realtimeConfiguration>;
    try {
      config = realtimeConfiguration();
    } catch {
      return {
        enabled: false,
        configured: false,
        reachable: false,
        ready: false,
        provider: "unknown",
        reason: "invalid_base_url",
      };
    }
    try {
      const response = await fetch(`${config.baseUrl}/health`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(Math.min(config.timeoutMs, 2_500)),
        cache: "no-store",
        redirect: "manual",
      });
      const payload = await boundedJson(response);
      const sidecarReady = response.ok && payload.ready === true;
      return {
        enabled: payload.enabled === true,
        configured: Boolean(config.sharedSecret) && payload.configured === true,
        reachable: true,
        ready: Boolean(config.sharedSecret) && sidecarReady,
        provider: typeof payload.provider === "string" ? payload.provider : "unknown",
        ...(typeof payload.model === "string" ? { model: payload.model } : {}),
        ...(typeof payload.promptId === "string" ? { promptId: payload.promptId } : {}),
        ...(typeof payload.promptVersion === "string" ? { promptVersion: payload.promptVersion } : {}),
        ...(sidecarReady && config.sharedSecret ? {} : { reason: "provider_not_ready" }),
      };
    } catch {
      return {
        enabled: false,
        configured: Boolean(config.sharedSecret),
        reachable: false,
        ready: false,
        provider: "unknown",
        reason: "sidecar_unreachable",
      };
    }
  }
}
