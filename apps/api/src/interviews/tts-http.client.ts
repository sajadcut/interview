import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { getEnv } from "../config/env";
import type {
  TextToSpeechAdapter,
  TextToSpeechReadiness,
  TextToSpeechRequest,
  TextToSpeechResult,
} from "./text-to-speech.adapter";

export const TTS_CONTRACT_VERSION = "tts-synthesis.v1";
export const TTS_MAX_TEXT_CHARS = 4000;
export const TTS_MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const TTS_REQUEST_TIMEOUT_MS = 65_000;
const TTS_MAX_ATTEMPTS = 2;
const TTS_RETRY_BASE_MS = 200;
const MAX_HEALTH_RESPONSE_BYTES = 64 * 1024;
const MAX_RETRY_DELAY_MS = 5000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const PROVIDER_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
const WEAK_SECRETS = new Set(["changeme", "change_me", "replace_me", "replace-me", "example", "secret", "password"]);

type TtsClientErrorCode =
  | "tts_disabled"
  | "not_configured"
  | "invalid_request"
  | "unauthorized"
  | "contract_mismatch"
  | "payload_too_large"
  | "rate_limited"
  | "worker_error"
  | "provider_error"
  | "provider_unavailable"
  | "provider_timeout"
  | "network_error"
  | "client_timeout"
  | "invalid_response"
  | "unexpected_response";

const SAFE_ERROR_MESSAGES: Record<TtsClientErrorCode, string> = {
  tts_disabled: "Text-to-speech is disabled",
  not_configured: "Text-to-speech is not configured",
  invalid_request: "Text-to-speech request is invalid",
  unauthorized: "Text-to-speech client authentication failed",
  contract_mismatch: "Text-to-speech API contract version does not match",
  payload_too_large: "Text-to-speech payload exceeds the contract limit",
  rate_limited: "Text-to-speech provider is rate limited",
  worker_error: "Text-to-speech worker failed",
  provider_error: "Text-to-speech provider failed",
  provider_unavailable: "Text-to-speech provider is unavailable",
  provider_timeout: "Text-to-speech provider timed out",
  network_error: "Text-to-speech provider network request failed",
  client_timeout: "Text-to-speech client request timed out",
  invalid_response: "Text-to-speech provider returned an invalid response",
  unexpected_response: "Text-to-speech provider returned an unexpected HTTP response",
};

export class TtsClientError extends Error {
  readonly code: TtsClientErrorCode;
  readonly retryable: boolean;
  readonly attempts: number;
  readonly requestId: string;
  readonly httpStatus: number | undefined;

  constructor(
    code: TtsClientErrorCode,
    options: { retryable: boolean; attempts: number; requestId: string; httpStatus?: number },
  ) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "TtsClientError";
    this.code = code;
    this.retryable = options.retryable;
    this.attempts = options.attempts;
    this.requestId = options.requestId;
    this.httpStatus = options.httpStatus;
  }
}

function endpoint(baseUrl: string, path: "health" | "synthesize"): string {
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
  if (/^\d+$/.test(value.trim())) return Math.min(Number(value.trim()) * 1000, MAX_RETRY_DELAY_MS);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(0, parsed - Date.now()), MAX_RETRY_DELAY_MS);
}

export function computeTtsRetryDelayMs(failedAttempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(Math.max(0, retryAfterMs), MAX_RETRY_DELAY_MS);
  return Math.min(TTS_RETRY_BASE_MS * 2 ** Math.max(0, failedAttempt - 1), MAX_RETRY_DELAY_MS);
}

export function mapTtsHttpFailure(status: number, attempts: number, requestId: string): TtsClientError {
  const mapping: Record<number, { code: TtsClientErrorCode; retryable: boolean }> = {
    400: { code: "invalid_request", retryable: false },
    401: { code: "unauthorized", retryable: false },
    409: { code: "contract_mismatch", retryable: false },
    413: { code: "payload_too_large", retryable: false },
    429: { code: "rate_limited", retryable: true },
    500: { code: "worker_error", retryable: true },
    502: { code: "provider_error", retryable: true },
    503: { code: "provider_unavailable", retryable: true },
    504: { code: "provider_timeout", retryable: true },
  };
  const mapped = mapping[status];
  if (mapped) {
    return new TtsClientError(mapped.code, { retryable: mapped.retryable, attempts, requestId, httpStatus: status });
  }
  return new TtsClientError(status >= 500 ? "provider_error" : "unexpected_response", {
    retryable: status >= 500,
    attempts,
    requestId,
    httpStatus: status,
  });
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error("response_too_large");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) throw new Error("response_too_large");
  return text;
}

async function readBoundedBytes(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error("response_too_large");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new Error("response_too_large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function hasValidWavHeader(audio: Uint8Array): boolean {
  if (audio.byteLength < 12) return false;
  return (
    String.fromCharCode(...audio.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...audio.subarray(8, 12)) === "WAVE"
  );
}

function productionConfigurationIsSafe(baseUrl: string | undefined, secret: string): boolean {
  const env = getEnv();
  if (env.NODE_ENV !== "production") return true;
  if (!baseUrl || new URL(baseUrl).protocol !== "https:") return false;
  return Buffer.byteLength(secret, "utf8") >= 32 && !WEAK_SECRETS.has(secret.trim().toLowerCase());
}

@Injectable()
export class TtsHttpClient implements TextToSpeechAdapter {
  readonly providerKey = "local-http";

  get enabled(): boolean {
    return getEnv().TTS_PROVIDER === "local-http";
  }

  get configured(): boolean {
    const env = getEnv();
    return (
      env.TTS_PROVIDER === "local-http" &&
      Boolean(env.TTS_BASE_URL && env.MEDIA_WORKER_SHARED_SECRET) &&
      productionConfigurationIsSafe(env.TTS_BASE_URL, env.MEDIA_WORKER_SHARED_SECRET)
    );
  }

  deploymentStatus() {
    const env = getEnv();
    return {
      provider: this.providerKey,
      contractVersion: TTS_CONTRACT_VERSION,
      enabled: this.enabled,
      configured: this.configured,
      baseUrlConfigured: Boolean(env.TTS_BASE_URL),
      requestTimeoutMs: TTS_REQUEST_TIMEOUT_MS,
      maxAttempts: TTS_MAX_ATTEMPTS,
      maxTextChars: TTS_MAX_TEXT_CHARS,
      maxAudioBytes: TTS_MAX_AUDIO_BYTES,
      independentOf: ["llm", "whisper", "livekit", "ffmpeg"] as const,
    };
  }

  async readiness(): Promise<TextToSpeechReadiness> {
    const env = getEnv();
    if (!this.enabled) return { reachable: false, ready: false, reason: "tts_disabled" };
    if (!this.configured || !env.TTS_BASE_URL) return { reachable: false, ready: false, reason: "not_configured" };
    try {
      const response = await fetch(endpoint(env.TTS_BASE_URL, "health"), {
        method: "GET",
        headers: { accept: "application/json", "x-tts-contract-version": TTS_CONTRACT_VERSION },
        signal: AbortSignal.timeout(env.MEDIA_PROVIDER_TIMEOUT_MS),
        cache: "no-store",
        redirect: "manual",
      });
      if (!response.ok) return { reachable: true, ready: false, reason: `http_${response.status}` };
      if (
        response.headers.get("x-tts-contract-version") !== TTS_CONTRACT_VERSION ||
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
        row.contractVersion !== TTS_CONTRACT_VERSION ||
        row.provider !== "local-command" ||
        row.ready !== true
      ) {
        return { reachable: true, ready: false, reason: "invalid_response" };
      }
      return { reachable: true, ready: true, contractVersion: TTS_CONTRACT_VERSION };
    } catch (cause) {
      return { reachable: false, ready: false, reason: isTimeoutError(cause) ? "client_timeout" : "network_error" };
    }
  }

  async synthesize(request: TextToSpeechRequest): Promise<TextToSpeechResult> {
    const env = getEnv();
    const requestId = request.requestId ?? randomUUID();
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      throw new TtsClientError("invalid_request", { retryable: false, attempts: 0, requestId: randomUUID() });
    }
    if (!this.enabled) throw new TtsClientError("tts_disabled", { retryable: false, attempts: 0, requestId });
    if (!this.configured || !env.TTS_BASE_URL) {
      throw new TtsClientError("not_configured", { retryable: false, attempts: 0, requestId });
    }
    const spokenText = request.spokenText.trim();
    if (!spokenText || spokenText.length > TTS_MAX_TEXT_CHARS || spokenText.includes("\0")) {
      throw new TtsClientError("invalid_request", { retryable: false, attempts: 0, requestId });
    }

    for (let attempt = 1; attempt <= TTS_MAX_ATTEMPTS; attempt += 1) {
      let failure: TtsClientError;
      let retryAfterMs: number | undefined;
      try {
        const response = await fetch(endpoint(env.TTS_BASE_URL, "synthesize"), {
          method: "POST",
          headers: {
            accept: "audio/wav",
            "content-type": "application/json",
            "x-tts-secret": env.MEDIA_WORKER_SHARED_SECRET,
            "x-tts-contract-version": TTS_CONTRACT_VERSION,
            "x-request-id": requestId,
          },
          body: JSON.stringify({ spokenText }),
          signal: AbortSignal.timeout(TTS_REQUEST_TIMEOUT_MS),
          cache: "no-store",
          redirect: "manual",
        });
        if (!response.ok) {
          failure = mapTtsHttpFailure(response.status, attempt, requestId);
          retryAfterMs = retryAfterMilliseconds(response.headers.get("retry-after"));
        } else {
          const provider = response.headers.get("x-tts-provider")?.trim() ?? "";
          if (
            response.headers.get("x-tts-contract-version") !== TTS_CONTRACT_VERSION ||
            response.headers.get("x-request-id") !== requestId ||
            normalizedContentType(response.headers.get("content-type")) !== "audio/wav" ||
            !PROVIDER_PATTERN.test(provider)
          ) {
            throw new TtsClientError("invalid_response", {
              retryable: false,
              attempts: attempt,
              requestId,
              httpStatus: response.status,
            });
          }
          let audio: Uint8Array;
          try {
            audio = await readBoundedBytes(response, TTS_MAX_AUDIO_BYTES);
          } catch {
            throw new TtsClientError("invalid_response", {
              retryable: false,
              attempts: attempt,
              requestId,
              httpStatus: response.status,
            });
          }
          if (!hasValidWavHeader(audio)) {
            throw new TtsClientError("invalid_response", {
              retryable: false,
              attempts: attempt,
              requestId,
              httpStatus: response.status,
            });
          }
          return {
            contractVersion: TTS_CONTRACT_VERSION,
            provider,
            requestId,
            audio,
            contentType: "audio/wav",
            attempts: attempt,
          };
        }
      } catch (cause) {
        if (cause instanceof TtsClientError) throw cause;
        failure = new TtsClientError(isTimeoutError(cause) ? "client_timeout" : "network_error", {
          retryable: true,
          attempts: attempt,
          requestId,
        });
      }
      if (!failure.retryable || attempt >= TTS_MAX_ATTEMPTS) throw failure;
      await new Promise((resolve) => setTimeout(resolve, computeTtsRetryDelayMs(attempt, retryAfterMs)));
    }

    throw new TtsClientError("provider_error", { retryable: true, attempts: TTS_MAX_ATTEMPTS, requestId });
  }
}
