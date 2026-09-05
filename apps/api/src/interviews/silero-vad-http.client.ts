import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { getEnv } from "../config/env";
import type {
  VoiceActivityDetectionAdapter,
  VoiceActivityReadiness,
  VoiceActivityRequest,
  VoiceActivityResult,
  VoiceActivitySegment,
} from "./voice-activity-detection.adapter";

export const SILERO_VAD_CONTRACT_VERSION = "silero-vad.v1";
export const SILERO_VAD_MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const SILERO_VAD_MAX_AUDIO_SECONDS = 300;
export const SILERO_VAD_TARGET_SAMPLE_RATE = 16000;

const VAD_REQUEST_TIMEOUT_MS = 15_000;
const VAD_MAX_ATTEMPTS = 2;
const VAD_RETRY_BASE_MS = 100;
const MAX_HEALTH_RESPONSE_BYTES = 64 * 1024;
const MAX_ANALYZE_RESPONSE_BYTES = 256 * 1024;
const MAX_RETRY_DELAY_MS = 5000;
const MAX_SEGMENTS = 1000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const WEAK_SECRETS = new Set([
  "changeme",
  "change_me",
  "replace_me",
  "replace-me",
  "example",
  "secret",
  "password",
]);

type VadClientErrorCode =
  | "vad_disabled"
  | "not_configured"
  | "invalid_request"
  | "unauthorized"
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

const SAFE_ERROR_MESSAGES: Record<VadClientErrorCode, string> = {
  vad_disabled: "Voice activity detection is disabled",
  not_configured: "Silero VAD is not configured",
  invalid_request: "Voice activity request is invalid",
  unauthorized: "Voice activity client authentication failed",
  contract_mismatch: "Voice activity API contract version does not match",
  payload_too_large: "Voice activity audio payload exceeds the contract limit",
  unsupported_media_type: "Voice activity audio content type is unsupported",
  invalid_audio: "Voice activity audio payload is invalid",
  rate_limited: "Voice activity provider is rate limited",
  worker_error: "Voice activity worker failed",
  provider_error: "Silero VAD provider failed",
  provider_unavailable: "Silero VAD provider is unavailable",
  provider_timeout: "Silero VAD provider timed out",
  network_error: "Silero VAD network request failed",
  client_timeout: "Silero VAD client request timed out",
  invalid_response: "Silero VAD returned an invalid response",
  unexpected_response: "Silero VAD returned an unexpected HTTP response",
};

export class VadClientError extends Error {
  readonly code: VadClientErrorCode;
  readonly retryable: boolean;
  readonly attempts: number;
  readonly requestId: string;
  readonly httpStatus: number | undefined;

  constructor(
    code: VadClientErrorCode,
    options: {
      retryable: boolean;
      attempts: number;
      requestId: string;
      httpStatus?: number;
    },
  ) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "VadClientError";
    this.code = code;
    this.retryable = options.retryable;
    this.attempts = options.attempts;
    this.requestId = options.requestId;
    this.httpStatus = options.httpStatus;
  }
}

function endpoint(baseUrl: string, path: "health" | "analyze"): string {
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

export function computeVadRetryDelayMs(
  failedAttempt: number,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined) {
    return Math.min(Math.max(0, retryAfterMs), MAX_RETRY_DELAY_MS);
  }
  return Math.min(
    VAD_RETRY_BASE_MS * 2 ** Math.max(0, failedAttempt - 1),
    MAX_RETRY_DELAY_MS,
  );
}

export function mapVadHttpFailure(
  status: number,
  attempts: number,
  requestId: string,
): VadClientError {
  const mapping: Record<number, { code: VadClientErrorCode; retryable: boolean }> = {
    400: { code: "invalid_request", retryable: false },
    401: { code: "unauthorized", retryable: false },
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
    return new VadClientError(mapped.code, {
      retryable: mapped.retryable,
      attempts,
      requestId,
      httpStatus: status,
    });
  }
  return new VadClientError(
    status >= 500 ? "provider_error" : "unexpected_response",
    {
      retryable: status >= 500,
      attempts,
      requestId,
      httpStatus: status,
    },
  );
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("response_too_large");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new Error("response_too_large");
  }
  return text;
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseSegments(
  value: unknown,
  durationSeconds: number,
): VoiceActivitySegment[] | null {
  if (!Array.isArray(value) || value.length > MAX_SEGMENTS) return null;
  const segments: VoiceActivitySegment[] = [];
  let previousEnd = 0;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (!validNumber(row.startSeconds) || !validNumber(row.endSeconds)) return null;
    if (
      row.startSeconds < 0 ||
      row.endSeconds <= row.startSeconds ||
      row.endSeconds > durationSeconds + 0.001
    ) {
      return null;
    }
    if (segments.length > 0 && row.startSeconds < previousEnd - 0.001) return null;
    segments.push({
      startSeconds: row.startSeconds,
      endSeconds: Math.min(row.endSeconds, durationSeconds),
    });
    previousEnd = row.endSeconds;
  }
  return segments;
}

function productionConfigurationIsSafe(
  baseUrl: string | undefined,
  secret: string,
): boolean {
  const env = getEnv();
  if (env.NODE_ENV !== "production") return true;
  if (!baseUrl || new URL(baseUrl).protocol !== "https:") return false;
  return (
    Buffer.byteLength(secret, "utf8") >= 32 &&
    !WEAK_SECRETS.has(secret.trim().toLowerCase())
  );
}

@Injectable()
export class SileroVadHttpClient implements VoiceActivityDetectionAdapter {
  readonly providerKey = "silero-http";

  get enabled(): boolean {
    return getEnv().VAD_PROVIDER === "silero-http";
  }

  get configured(): boolean {
    const env = getEnv();
    return (
      env.VAD_PROVIDER === "silero-http" &&
      Boolean(env.VAD_BASE_URL && env.MEDIA_WORKER_SHARED_SECRET) &&
      productionConfigurationIsSafe(
        env.VAD_BASE_URL,
        env.MEDIA_WORKER_SHARED_SECRET,
      )
    );
  }

  deploymentStatus() {
    const env = getEnv();
    return {
      provider: this.providerKey,
      engine: "silero-vad",
      contractVersion: SILERO_VAD_CONTRACT_VERSION,
      enabled: this.enabled,
      configured: this.configured,
      baseUrlConfigured: Boolean(env.VAD_BASE_URL),
      requestTimeoutMs: VAD_REQUEST_TIMEOUT_MS,
      maxAttempts: VAD_MAX_ATTEMPTS,
      maxAudioBytes: SILERO_VAD_MAX_AUDIO_BYTES,
      maxAudioSeconds: SILERO_VAD_MAX_AUDIO_SECONDS,
      targetSampleRate: SILERO_VAD_TARGET_SAMPLE_RATE,
      independentOf: ["llm", "whisper", "livekit", "ffmpeg", "tts"] as const,
    };
  }

  async readiness(): Promise<VoiceActivityReadiness> {
    const env = getEnv();
    if (!this.enabled) {
      return { reachable: false, ready: false, reason: "vad_disabled" };
    }
    if (!this.configured || !env.VAD_BASE_URL) {
      return { reachable: false, ready: false, reason: "not_configured" };
    }
    try {
      const response = await fetch(endpoint(env.VAD_BASE_URL, "health"), {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-vad-contract-version": SILERO_VAD_CONTRACT_VERSION,
        },
        signal: AbortSignal.timeout(env.MEDIA_PROVIDER_TIMEOUT_MS),
        cache: "no-store",
        redirect: "manual",
      });
      if (!response.ok) {
        return {
          reachable: true,
          ready: false,
          reason: `http_${response.status}`,
        };
      }
      if (
        response.headers.get("x-vad-contract-version") !==
          SILERO_VAD_CONTRACT_VERSION ||
        normalizedContentType(response.headers.get("content-type")) !==
          "application/json"
      ) {
        return { reachable: true, ready: false, reason: "contract_mismatch" };
      }
      let payload: unknown;
      try {
        payload = JSON.parse(
          await readBoundedText(response, MAX_HEALTH_RESPONSE_BYTES),
        ) as unknown;
      } catch {
        return { reachable: true, ready: false, reason: "invalid_response" };
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { reachable: true, ready: false, reason: "invalid_response" };
      }
      const row = payload as Record<string, unknown>;
      if (
        row.contractVersion !== SILERO_VAD_CONTRACT_VERSION ||
        row.provider !== "silero-vad" ||
        row.ready !== true ||
        row.targetSampleRate !== SILERO_VAD_TARGET_SAMPLE_RATE
      ) {
        return { reachable: true, ready: false, reason: "invalid_response" };
      }
      return {
        reachable: true,
        ready: true,
        contractVersion: SILERO_VAD_CONTRACT_VERSION,
      };
    } catch (cause) {
      return {
        reachable: false,
        ready: false,
        reason: isTimeoutError(cause) ? "client_timeout" : "network_error",
      };
    }
  }

  async analyze(request: VoiceActivityRequest): Promise<VoiceActivityResult> {
    const env = getEnv();
    const requestId = request.requestId ?? randomUUID();
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      throw new VadClientError("invalid_request", {
        retryable: false,
        attempts: 0,
        requestId: randomUUID(),
      });
    }
    if (!this.enabled) {
      throw new VadClientError("vad_disabled", {
        retryable: false,
        attempts: 0,
        requestId,
      });
    }
    if (!this.configured || !env.VAD_BASE_URL) {
      throw new VadClientError("not_configured", {
        retryable: false,
        attempts: 0,
        requestId,
      });
    }
    if (
      request.contentType !== "audio/wav" &&
      request.contentType !== "audio/x-wav"
    ) {
      throw new VadClientError("unsupported_media_type", {
        retryable: false,
        attempts: 0,
        requestId,
      });
    }
    if (request.audio.byteLength === 0) {
      throw new VadClientError("invalid_request", {
        retryable: false,
        attempts: 0,
        requestId,
      });
    }
    if (request.audio.byteLength > SILERO_VAD_MAX_AUDIO_BYTES) {
      throw new VadClientError("payload_too_large", {
        retryable: false,
        attempts: 0,
        requestId,
      });
    }

    for (let attempt = 1; attempt <= VAD_MAX_ATTEMPTS; attempt += 1) {
      let failure: VadClientError;
      let retryAfterMs: number | undefined;
      try {
        const response = await fetch(endpoint(env.VAD_BASE_URL, "analyze"), {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": request.contentType,
            "x-vad-secret": env.MEDIA_WORKER_SHARED_SECRET,
            "x-vad-contract-version": SILERO_VAD_CONTRACT_VERSION,
            "x-request-id": requestId,
          },
          body: Buffer.from(request.audio),
          signal: AbortSignal.timeout(VAD_REQUEST_TIMEOUT_MS),
          cache: "no-store",
          redirect: "manual",
        });
        if (!response.ok) {
          failure = mapVadHttpFailure(response.status, attempt, requestId);
          retryAfterMs = retryAfterMilliseconds(response.headers.get("retry-after"));
        } else {
          if (
            response.headers.get("x-vad-contract-version") !==
              SILERO_VAD_CONTRACT_VERSION ||
            normalizedContentType(response.headers.get("content-type")) !==
              "application/json"
          ) {
            throw new VadClientError("invalid_response", {
              retryable: false,
              attempts: attempt,
              requestId,
              httpStatus: response.status,
            });
          }
          let payload: unknown;
          try {
            payload = JSON.parse(
              await readBoundedText(response, MAX_ANALYZE_RESPONSE_BYTES),
            ) as unknown;
          } catch {
            throw new VadClientError("invalid_response", {
              retryable: false,
              attempts: attempt,
              requestId,
              httpStatus: response.status,
            });
          }
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            throw new VadClientError("invalid_response", {
              retryable: false,
              attempts: attempt,
              requestId,
              httpStatus: response.status,
            });
          }
          const row = payload as Record<string, unknown>;
          if (
            row.contractVersion !== SILERO_VAD_CONTRACT_VERSION ||
            row.provider !== "silero-vad" ||
            row.requestId !== requestId ||
            typeof row.speechDetected !== "boolean" ||
            row.sampleRate !== SILERO_VAD_TARGET_SAMPLE_RATE ||
            !validNumber(row.durationSeconds) ||
            row.durationSeconds <= 0 ||
            row.durationSeconds > SILERO_VAD_MAX_AUDIO_SECONDS
          ) {
            throw new VadClientError("invalid_response", {
              retryable: false,
              attempts: attempt,
              requestId,
              httpStatus: response.status,
            });
          }
          const segments = parseSegments(row.segments, row.durationSeconds);
          if (
            segments === null ||
            row.speechDetected !== (segments.length > 0)
          ) {
            throw new VadClientError("invalid_response", {
              retryable: false,
              attempts: attempt,
              requestId,
              httpStatus: response.status,
            });
          }
          return {
            contractVersion: SILERO_VAD_CONTRACT_VERSION,
            provider: "silero-vad",
            requestId,
            speechDetected: row.speechDetected,
            segments,
            sampleRate: SILERO_VAD_TARGET_SAMPLE_RATE,
            durationSeconds: row.durationSeconds,
            attempts: attempt,
          };
        }
      } catch (cause) {
        if (cause instanceof VadClientError) throw cause;
        failure = new VadClientError(
          isTimeoutError(cause) ? "client_timeout" : "network_error",
          {
            retryable: true,
            attempts: attempt,
            requestId,
          },
        );
      }
      if (!failure.retryable || attempt >= VAD_MAX_ATTEMPTS) throw failure;
      await new Promise((resolve) =>
        setTimeout(resolve, computeVadRetryDelayMs(attempt, retryAfterMs)),
      );
    }

    throw new VadClientError("provider_error", {
      retryable: true,
      attempts: VAD_MAX_ATTEMPTS,
      requestId,
    });
  }
}
