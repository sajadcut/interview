import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { LLMProviderError } from "./llm-provider.mjs";
import {
  LLM_INTERVIEWER_CAPABILITY,
  LLM_INTERVIEWER_CAPABILITY_VERSION,
  LLM_INTERVIEWER_CONTRACT_VERSION,
  LLM_INTERVIEWER_PROMPT_ID,
  LLM_INTERVIEWER_PROMPT_VERSION,
  LLM_INTERVIEWER_SCHEMA_VERSION,
  generateConversationalInterviewTurn,
} from "./interviewer-capability.mjs";

const MAX_REQUEST_BYTES = 96 * 1024;
const PROVIDER_READINESS_TIMEOUT_MS = 2_000;
const PROVIDER_READINESS_CACHE_MS = 30_000;

function writeJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
    "x-llm-interviewer-contract-version": LLM_INTERVIEWER_CONTRACT_VERSION,
  });
  response.end(body);
}

function authorized(supplied, expected) {
  if (!supplied || !expected) return false;
  const left = Buffer.from(String(supplied), "utf8");
  const right = Buffer.from(String(expected), "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJsonBody(request) {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new LLMProviderError("BUDGET_EXCEEDED");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > MAX_REQUEST_BYTES) throw new LLMProviderError("BUDGET_EXCEEDED");
    chunks.push(value);
  }
  if (size === 0) throw new LLMProviderError("INVALID_REQUEST");
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
  } catch {
    throw new LLMProviderError("INVALID_REQUEST");
  }
}

function validateEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LLMProviderError("INVALID_REQUEST");
  if (value.contractVersion !== LLM_INTERVIEWER_CONTRACT_VERSION) throw new LLMProviderError("INVALID_REQUEST");
  if (value.capability !== LLM_INTERVIEWER_CAPABILITY) throw new LLMProviderError("INVALID_REQUEST");
  if (value.capabilityVersion !== LLM_INTERVIEWER_CAPABILITY_VERSION) throw new LLMProviderError("INVALID_REQUEST");
  if (value.promptId !== LLM_INTERVIEWER_PROMPT_ID || value.promptVersion !== LLM_INTERVIEWER_PROMPT_VERSION) {
    throw new LLMProviderError("UNKNOWN_PROMPT");
  }
  if (value.structuredOutputSchemaVersion !== LLM_INTERVIEWER_SCHEMA_VERSION) {
    throw new LLMProviderError("INVALID_REQUEST");
  }
  if (!value.input || typeof value.input !== "object" || Array.isArray(value.input)) {
    throw new LLMProviderError("INVALID_REQUEST");
  }
  return value;
}

function statusFor(error) {
  if (!(error instanceof LLMProviderError)) return 502;
  if (error.code === "INVALID_REQUEST" || error.code === "UNKNOWN_PROMPT" || error.code === "PROMPT_VARIABLE_MISMATCH") return 400;
  if (error.code === "BUDGET_EXCEEDED") return 413;
  if (error.code === "PROVIDER_TIMEOUT" || error.code === "REQUEST_ABORTED") return 504;
  if (error.code === "PROVIDER_UNAVAILABLE") return 503;
  if (error.code === "STRUCTURED_OUTPUT_INVALID" || error.code === "USAGE_INVALID") return 502;
  return 502;
}

function safeError(error) {
  if (error instanceof LLMProviderError) return { code: error.code, message: error.message };
  return { code: "PROVIDER_FAILURE", message: "LLM provider request failed" };
}

function normalizedReadiness(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { reachable: false, ready: false, reason: "provider_readiness_invalid" };
  }
  return {
    reachable: value.reachable === true,
    ready: value.ready === true,
    ...(typeof value.reason === "string" && value.reason.trim() ? { reason: value.reason.trim().slice(0, 120) } : {}),
  };
}

export function createInterviewerHttpServer({ llm, sharedSecret, providerInfo, providerReadiness }) {
  if (!sharedSecret?.trim()) throw new Error("AI_WORKER_SHARED_SECRET is required for realtime interviewer");
  const info = {
    provider: providerInfo?.provider ?? "unknown",
    model: providerInfo?.model ?? null,
    enabled: providerInfo?.enabled === true,
    configured: providerInfo?.configured === true,
  };
  let readinessCache = null;
  let readinessExpiresAt = 0;
  let readinessInFlight = null;

  async function getProviderReadiness() {
    if (!info.enabled) return { reachable: false, ready: false, reason: "provider_disabled" };
    if (!info.configured) return { reachable: false, ready: false, reason: "provider_not_configured" };
    if (Date.now() < readinessExpiresAt && readinessCache) return readinessCache;
    if (readinessInFlight) return readinessInFlight;
    readinessInFlight = (async () => {
      let result;
      if (typeof providerReadiness !== "function") {
        result = { reachable: false, ready: false, reason: "provider_readiness_unavailable" };
      } else {
        try {
          result = normalizedReadiness(await providerReadiness({
            signal: AbortSignal.timeout(PROVIDER_READINESS_TIMEOUT_MS),
          }));
        } catch {
          result = { reachable: false, ready: false, reason: "provider_unreachable" };
        }
      }
      readinessCache = result;
      readinessExpiresAt = Date.now() + PROVIDER_READINESS_CACHE_MS;
      return result;
    })();
    try {
      return await readinessInFlight;
    } finally {
      readinessInFlight = null;
    }
  }

  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (request.method === "GET" && path === "/health") {
        const providerState = await getProviderReadiness();
        writeJson(response, 200, {
          service: "llm-interviewer",
          contractVersion: LLM_INTERVIEWER_CONTRACT_VERSION,
          enabled: info.enabled,
          configured: info.configured,
          reachable: providerState.reachable,
          ready: info.enabled && info.configured && providerState.ready,
          provider: info.provider,
          ...(info.model ? { model: info.model } : {}),
          promptId: LLM_INTERVIEWER_PROMPT_ID,
          promptVersion: LLM_INTERVIEWER_PROMPT_VERSION,
          fallbackAvailable: true,
          ...(providerState.reason ? { reason: providerState.reason } : {}),
        });
        return;
      }

      if (request.method !== "POST" || path !== "/v1/interview/next-turn") {
        writeJson(response, 404, { error: { code: "NOT_FOUND", message: "Not Found" } });
        return;
      }
      if (!authorized(request.headers["x-ai-worker-secret"], sharedSecret)) {
        writeJson(response, 401, { error: { code: "UNAUTHORIZED", message: "Realtime interviewer authentication failed" } });
        return;
      }

      const envelope = validateEnvelope(await readJsonBody(request));
      const executionId = randomUUID();
      const generated = await generateConversationalInterviewTurn({
        llm,
        input: envelope.input,
        metadata: {
          executionId,
          inputReferences:
            envelope.inputReferences && typeof envelope.inputReferences === "object" && !Array.isArray(envelope.inputReferences)
              ? envelope.inputReferences
              : {},
        },
      });
      writeJson(response, 200, {
        contractVersion: LLM_INTERVIEWER_CONTRACT_VERSION,
        executionId,
        output: generated.output,
        provenance: generated.provenance,
      });
    } catch (error) {
      const safe = safeError(error);
      writeJson(response, statusFor(error), { error: safe });
    }
  });
}
