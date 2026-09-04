import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { getEnv } from "../config/env";
import type {
  SpeechToTextAdapter,
  SpeechToTextReadiness,
  SpeechToTextRequest,
  SpeechToTextResult,
} from "./speech-to-text.adapter";

export const WHISPER_STT_CONTRACT_VERSION = "whisper-stt.v1";
export const WHISPER_MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const WHISPER_SUPPORTED_CONTENT_TYPES = ["audio/wav", "audio/x-wav"] as const;

const MAX_SUCCESS_RESPONSE_BYTES = 1024 * 1024;
const MAX_HEALTH_RESPONSE_BYTES = 64 * 1024;
const MAX_RETRY_DELAY_MS = 5000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

type WhisperClientErrorCode =
  | "stt_disabled"
  | "not_configured"
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "contract_mismatch"
  | "payload_too_large"
  | "unsupported_media_type"
  | "invalid_audio"
  | "rate_limited"
  | "worker_error"
  | "provider_error"
  | "provider_unavailable"
  | "provider_timeout"
  | "network_error"
  | "client_timeout"
  | "invalid_response"
  | "unexpected_response";

const SAFE_ERROR_MESSAGES: Record<WhisperClientErrorCode, string> = {
  stt_disabled: "Speech-to-text is disabled",
  not_configured: "Whisper speech-to-text is not configured",
  invalid_request: "Whisper request is invalid",
  unauthorized: "Whisper client authentication failed",
  forbidden: "Whisper request was forbidden",
  contract_mismatch: "Whisper API contract version does not match",
  payload_too_large: "Whisper audio payload exceeds the contract limit",
  unsupported_media_type: "Whisper audio content type is unsupported",
  invalid_audio: "Whisper audio payload is invalid",
  rate_limited: "Whisper provider is rate limited",
  worker_error: "Whisper worker failed",
  provider_error: "Whisper provider failed",
  provider_unavailable: "Whisper provider is unavailable",
  provider_timeout: "Whisper provider timed out",
  network_error: "Whisper provider network request failed",
  client_timeout: "Whisper client request timed out",
  invalid_response: "Whisper provider returned an invalid response",
  unexpected_response: "Whisper provider returned an unexpected HTTP response",
};

export class WhisperClientError extends Error {
  readonly code: WhisperClientErrorCode;
  readonly retryable: boolean;
  readonly attempts: number;
  readonly requestId: string;
  readonly httpStatus: number | undefined;

  constructor(
    code: WhisperClientErrorCode,
    options: {
      retryable: boolean;
      attempts: number;
      requestId: string;
      httpStatus?: number;
    },
  ) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "WhisperClientError";
    this.code = code;
    this.retryable = options.retryable;
    this.attempts = options.attempts;
    this.requestId = options.requestId;
    this.httpStatus = options.httpStatus;
  }
}

function endpoint(baseUrl: string, path: "health" | "finalize"): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path, normalized).toString();
}

function normalizedContentType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isTimeoutError(cause: unknown): boolean {
  return (
    (cause instanceof DOMException && ["TimeoutError", "AbortError"].includes(cause.name)) ||
    (cause instanceof Error && /timeout/i.test(cause.name))
  );
}

function retryAfterMilliseconds(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) {
    return Math.min(Number(value.trim()) * 1000, MAX_RETRY_DELAY_MS);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(0, parsed - Date.now()), MAX_RETRY_DELAY_MS);
}

export function computeWhisperRetryDelayMs(
  failedAttempt: number,
  baseDelayMs: number,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined) return Math.min(Math.max(0, retryAfterMs), MAX_RETRY_DELAY_MS);
  return Math.min(baseDelayMs * 2 ** Math.max(0, failedAttempt - 1), MAX_RETRY_DELAY_MS);
}

export function mapWhisperHttpFailure(
  status: number,
  attempts: number,
  requestId: string,
): WhisperClientError {
  const mapping: Record<number, { code: WhisperClientErrorCode; retryable: boolean }> = {
    400: { code: "invalid_request", retryable: false },
    401: { code: "unauthorized", retryable: false },
    403: { code: "forbidden", retryable: false },
    409: { code: "contract_mismatch", retryable: false },
    413: { code: "payload_too_large", retryable: false },
    415: { code: "unsupported_media_type", retryable: false },
    422: { code: "invalid_audio", retryable: false },
    429: { code: "rate_limited", retryable: true },
    500: { code: "worker_error", retryable: true },
    502: { code: "provider_error", retryable: true },
    503: { code: "provider_unavailable", retryable: true },
    504: { code: "provider_timeout", retryable: true },
  };
  const mapped = mapping[status];
  if (mapped) {
    return new WhisperClientError(mapped.code, {
      retryable: mapped.retryable,
      attempts,
      requestId,
      httpStatus: status,
    });
  }
  return new WhisperClientError(status >= 500 ? "provider_error" : "unexpected_response", {
    retryable: status >= 500,
    attempts,
    requestId,
    httpStatus: status,
  });
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("response_too_large");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) throw new Error("response_too_large");
  return text;
}

async function parseSuccessResponse(
  response: Response,
  requestId: string,
  attempts: number,
): Promise<SpeechToTextResult> {
  if (
    response.headers.get("x-stt-contract-version") !== WHISPER_STT_CONTRACT_VERSION ||
    normalizedContentType(response.headers.get("content-type")) !== "application/json"
  ) {
    throw new WhisperClientError("invalid_response", {
      retryable: false,
      attempts,
      requestId,
      httpStatus: response.status,
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await readBoundedText(response, MAX_SUCCESS_RESPONSE_BYTES));
  } catch {
    throw new WhisperClientError("invalid_response", {
      retryable: false,
      attempts,
      requestId,
      httpStatus: response.status,
    });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new WhisperClientError("invalid_response", {
      retryable: false,
      attempts,
      requestId,
      httpStatus: response.status,
    });
  }
  const row = payload as Record<string, unknown>;
  if (
    row.contractVersion !== WHISPER_STT_CONTRACT_VERSION ||
    row.requestId !== requestId ||
    row.provider !== "whisper.cpp" ||
    typeof row.text !== "string" ||
    Buffer.byteLength(row.text, "utf8") > MAX_SUCCESS_RESPONSE_BYTES ||
    row.isFinal !== true ||
    typeof row.language !== "string" ||
    row.language.length === 0 ||
    row.language.length > 64
  ) {
    throw new WhisperClientError("invalid_response", {
      retryable: false,
      attempts,
      requestId,
      httpStatus: response.status,
    });
  }
  return {
    contractVersion: WHISPER_STT_CONTRACT_VERSION,
    provider: "whisper.cpp",
    requestId,
    text: row.text,
    isFinal: true,
    language: row.language,
    attempts,
  };
}

@Injectable()
export class WhisperHttpClient implements SpeechToTextAdapter {
  readonly providerKey = "whisper-http";

  get enabled(): boolean {
    return getEnv().STT_PROVIDER === "whisper-http";
  }

  get configured(): boolean {
    const env = getEnv();
    return env.STT_PROVIDER === "whisper-http" && Boolean(env.STT_BASE_URL && env.MEDIA_WORKER_SHARED_SECRET);
  }

  deploymentStatus() {
    const env = getEnv();
    return {
      provider: this.providerKey,
      engine: "whisper.cpp",
      contractVersion: WHISPER_STT_CONTRACT_VERSION,
      enabled: this.enabled,
      configured: this.configured,
      baseUrlConfigured: Boolean(env.STT_BASE_URL),
      requestTimeoutMs: env.STT_REQUEST_TIMEOUT_MS,
      maxAttempts: env.STT_MAX_ATTEMPTS,
      retryBaseMs: env.STT_RETRY_BASE_MS,
      maxAudioBytes: WHISPER_MAX_AUDIO_BYTES,
      supportedContentTypes: [...WHISPER_SUPPORTED_CONTENT_TYPES],
    };
  }

  async readiness(): Promise<SpeechToTextReadiness> {
    const env = getEnv();
    if (!this.enabled) return { reachable: false, ready: false, reason: "stt_disabled" };
    if (!this.configured || !env.STT_BASE_URL) {
      return { reachable: false, ready: false, reason: "not_configured" };
    }

    try {
      const response = await fetch(endpoint(env.STT_BASE_URL, "health"), {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-stt-contract-version": WHISPER_STT_CONTRACT_VERSION,
        },
        signal: AbortSignal.timeout(env.MEDIA_PROVIDER_TIMEOUT_MS),
        cache: "no-store",
        redirect: "manual",
      });
      if (!response.ok) return { reachable: true, ready: false, reason: `http_${response.status}` };
      if (
        response.headers.get("x-stt-contract-version") !== WHISPER_STT_CONTRACT_VERSION ||
        normalizedContentType(response.headers.get("content-type")) !== "application/json"
      ) {
        return { reachable: true, ready: false, reason: "contract_mismatch" };
      }
      let payload: unknown;
      try {
        payload = JSON.parse(await readBoundedText(response, MAX_HEALTH_RESPONSE_BYTES)) as unknown;
      } catch {
        return { reachable: true, ready: false, reason: "invalid_response" };
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { reachable: true, ready: false, reason: "invalid_response" };
      }
      const row = payload as Record<string, unknown>;
      if (
        row.contractVersion !== WHISPER_STT_CONTRACT_VERSION ||
        row.provider !== "whisper.cpp" ||
        row.ready !== true
      ) {
        return { reachable: true, ready: false, reason: "invalid_response" };
      }
      return { reachable: true, ready: true, contractVersion: WHISPER_STT_CONTRACT_VERSION };
    } catch (cause) {
      return {
        reachable: false,
        ready: false,
        reason: isTimeoutError(cause) ? "client_timeout" : "network_error",
      };
    }
  }

  async transcribe(request: SpeechToTextRequest): Promise<SpeechToTextResult> {
    const env = getEnv();
    const requestId = request.requestId ?? randomUUID();
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      throw new WhisperClientError("invalid_request", {
        retryable: false,
        attempts: 0,
        requestId: randomUUID(),
      });
    }
    if (!this.enabled) {
      throw new WhisperClientError("stt_disabled", { retryable: false, attempts: 0, requestId });
    }
    if (!this.configured || !env.STT_BASE_URL) {
      throw new WhisperClientError("not_configured", { retryable: false, attempts: 0, requestId });
    }
    if (!WHISPER_SUPPORTED_CONTENT_TYPES.some((value) => value === request.contentType)) {
      throw new WhisperClientError("unsupported_media_type", { retryable: false, attempts: 0, requestId });
    }
    if (request.audio.byteLength === 0) {
      throw new WhisperClientError("invalid_request", { retryable: false, attempts: 0, requestId });
    }
    if (request.audio.byteLength > WHISPER_MAX_AUDIO_BYTES) {
      throw new WhisperClientError("payload_too_large", { retryable: false, attempts: 0, requestId });
    }

    for (let attempt = 1; attempt <= env.STT_MAX_ATTEMPTS; attempt += 1) {
      let failure: WhisperClientError;
      let retryAfterMs: number | undefined;
      try {
        const response = await fetch(endpoint(env.STT_BASE_URL, "finalize"), {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": request.contentType,
            "x-media-worker-secret": env.MEDIA_WORKER_SHARED_SECRET,
            "x-stt-contract-version": WHISPER_STT_CONTRACT_VERSION,
            "x-request-id": requestId,
          },
          body: Buffer.from(request.audio),
          signal: AbortSignal.timeout(env.STT_REQUEST_TIMEOUT_MS),
          cache: "no-store",
          redirect: "manual",
        });
        if (response.ok) return await parseSuccessResponse(response, requestId, attempt);
        failure = mapWhisperHttpFailure(response.status, attempt, requestId);
        retryAfterMs = retryAfterMilliseconds(response.headers.get("retry-after"));
      } catch (cause) {
        if (cause instanceof WhisperClientError) throw cause;
        failure = new WhisperClientError(isTimeoutError(cause) ? "client_timeout" : "network_error", {
          retryable: true,
          attempts: attempt,
          requestId,
        });
      }

      if (!failure.retryable || attempt >= env.STT_MAX_ATTEMPTS) throw failure;
      await new Promise((resolve) =>
        setTimeout(resolve, computeWhisperRetryDelayMs(attempt, env.STT_RETRY_BASE_MS, retryAfterMs)),
      );
    }

    throw new WhisperClientError("provider_error", {
      retryable: true,
      attempts: env.STT_MAX_ATTEMPTS,
      requestId,
    });
  }
}
