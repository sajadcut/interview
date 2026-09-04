# Whisper STT Integration Contract v1

This document defines the API-owned contract between the core API and the self-hosted media worker for final Whisper transcription. The contract is intentionally testable without installing `whisper.cpp`.

## Source of truth

- Machine-readable contract: `contracts/whisper-stt.v1.json`
- API client: `apps/api/src/interviews/whisper-http.client.ts`
- Provider abstraction: `apps/api/src/interviews/speech-to-text.adapter.ts`
- Media-worker contract helpers: `services/media-worker/whisper_contract.py`
- Media-worker HTTP surface: `GET /stt/health` and `POST /stt/finalize`
- CI contract check: `npm run whisper:contract:check`

## Request contract

`POST /stt/finalize` accepts only `audio/wav` or `audio/x-wav`, up to 20 MiB. The API sends `x-media-worker-secret`, `x-stt-contract-version: whisper-stt.v1`, and a bounded `x-request-id`. Redirects are not followed by the API client so credentials and raw audio cannot be silently forwarded to another origin.

The API does not persist the raw request audio in this integration boundary and must not log audio bytes or the media-worker secret.

## Success contract

A successful response is HTTP 200 JSON with:

- `contractVersion = whisper-stt.v1`
- the same `requestId`
- `provider = whisper.cpp`
- `text`
- `isFinal = true`
- non-empty `language`

The response must also carry `x-stt-contract-version: whisper-stt.v1`. The API rejects a nominal HTTP 200 response if the version, content type, request id, provider, or schema does not match.

## Timeouts and retries

Each API attempt has its own `STT_REQUEST_TIMEOUT_MS`. Retry count is bounded by `STT_MAX_ATTEMPTS` (1–5). Backoff starts at `STT_RETRY_BASE_MS`, doubles per failed attempt, and is capped at 5 seconds. A bounded `Retry-After` header is honored.

Only transient conditions are retried: network/client timeout, HTTP 429, 500, 502, 503, and 504. Deterministic request/contract failures are not retried.

Recommended local defaults:

```text
STT_REQUEST_TIMEOUT_MS=130000
STT_MAX_ATTEMPTS=3
STT_RETRY_BASE_MS=250
WHISPER_TIMEOUT_SECONDS=120
```

The API timeout is intentionally longer than the worker subprocess timeout so the worker can return a structured `provider_timeout` response before the API aborts the attempt.

## Stable error mapping

The worker returns bounded structured errors with `code`, safe `message`, and `retryable`. Stable codes include:

`invalid_request`, `unauthorized`, `forbidden`, `contract_mismatch`, `payload_too_large`, `unsupported_media_type`, `invalid_audio`, `rate_limited`, `worker_error`, `provider_error`, `provider_unavailable`, and `provider_timeout`.

The API adds client-side `stt_disabled`, `not_configured`, `network_error`, `client_timeout`, `invalid_response`, and `unexpected_response` failures. Raw stderr, model paths, traceback text, provider response bodies, credentials, and audio data are not copied into API error messages.

## Readiness

`GET /stt/health` is provider-local and reports contract version, provider, readiness, max audio size, and supported content types. The core API additionally exposes an internal `GET /health/whisper` operational endpoint; it is excluded from public OpenAPI.

When `STT_PROVIDER=disabled`, the integration is optional and no provider call is made. When `STT_PROVIDER=whisper-http`, startup validation requires `STT_BASE_URL` and `MEDIA_WORKER_SHARED_SECRET`. Production requires HTTPS and a non-placeholder media-worker secret of at least 32 bytes.

## Evidence boundary

CI proves the transport contract, error semantics, retry logic, timeout behavior, validation, and mocked worker HTTP behavior. It does not prove transcription quality, model accuracy, real CPU/GPU performance, representative-language quality, or Gate F latency. Those require actual `whisper.cpp` runtime evidence later.
