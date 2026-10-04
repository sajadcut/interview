# Structured observability logging

The local/API observability path is JSON Lines with one trace propagated across API requests, outbound HTTP providers, queued AI work, the AI worker, LLM calls, embeddings/RAG HTTP calls, sourcing tool calls, STT/TTS/VAD and other HTTP integrations.

## Trace headers

Every API request receives:

- `x-trace-id`: 32 hex characters, stable for the end-to-end operation.
- `x-request-id`: request correlation id.
- `traceparent`: W3C trace context.

If valid trace headers are supplied by an upstream service they are preserved. Server-side outbound `fetch` calls propagate the same trace and create a child span id.

AI jobs persist the originating trace context inside their job payload. When the AI worker claims the job it restores that context before calling the LLM or reporting job completion.

## Log events

Primary event families:

```text
http.server.request
http.server.response
http.server.error

http.client.request
http.client.response
http.client.error

ai.job.enqueue.request
ai.job.enqueue.response
ai.job.processing.started
ai.job.processing.succeeded
ai.job.processing.failed

interviewer.http.request
interviewer.http.request.body
interviewer.http.response
interviewer.http.error
```

The HTTP client instrumentation covers calls made through the runtime `fetch` implementation, including LLM providers, embedding providers, approved sourcing providers and API-to-worker HTTP adapters.

## Body logging

`LOG_BODY_MODE`:

- `off`: no bodies.
- `metadata`: body kind/size only.
- `full`: JSON/text bodies up to `LOG_MAX_BODY_BYTES`.

Binary bodies such as audio, PDFs and arbitrary octet streams are logged as metadata rather than copied into log files.

Secret redaction is mandatory in every mode. Authorization headers, cookies, passwords, OTP values, API keys, credentials and keys ending in token/secret/password are redacted before console/file output.

Full-body mode can contain candidate PII and prompts. Use it for controlled debugging, restrict filesystem access, and return to `metadata` after diagnosis.

## File output and rotation

Default API log:

```text
.local-data/logs/interview-api.log
.local-data/logs/interview-api.log.1
.local-data/logs/interview-api.log.2
...
```

Default AI worker log:

```text
.local-data/logs/interview-ai-worker.log
.local-data/logs/interview-ai-worker.log.1
...
```

Rotation is size-based. `LOG_ROTATE_MAX_BYTES` controls maximum active-file size and `LOG_ROTATE_MAX_FILES` controls retained rotated files.

## Recommended local debugging configuration

```env
LOG_LEVEL=trace
LOG_CONSOLE_ENABLED=true
LOG_FILE_ENABLED=true
LOG_DIR=.local-data/logs
LOG_FILE_BASENAME=interview-api
LOG_ROTATE_MAX_BYTES=52428800
LOG_ROTATE_MAX_FILES=10
LOG_BODY_MODE=full
LOG_MAX_BODY_BYTES=2097152
LOG_HTTP_ENABLED=true
LOG_OUTBOUND_HTTP_ENABLED=true
TRACE_PROPAGATION_ENABLED=true

AI_WORKER_LOG_SERVICE_NAME=interview-ai-worker
AI_WORKER_LOG_DIR=.local-data/logs
AI_WORKER_LOG_FILE_BASENAME=interview-ai-worker
```

For larger LLM/RAG payloads, `LOG_MAX_BODY_BYTES` may be increased up to 10485760 (10 MiB).

## Windows PowerShell

> Windows PowerShell 5.1 may decode UTF-8 JSONL as the active ANSI code page when `-Encoding UTF8` is omitted. That produces mojibake such as `ØªÙ...` even when the log file itself is valid UTF-8.

Follow API logs:

```powershell
Get-Content .\.local-data\logs\interview-api.log -Encoding UTF8 -Wait
```

Follow AI worker logs:

```powershell
Get-Content .\.local-data\logs\interview-ai-worker.log -Encoding UTF8 -Wait
```

Find one end-to-end trace:

```powershell
$trace = "PUT_TRACE_ID_HERE"
Select-String -Path .\.local-data\logs\*.log* -Pattern $trace
```

Parse recent API JSON lines:

```powershell
Get-Content .\.local-data\logs\interview-api.log -Encoding UTF8 -Tail 100 |
  ForEach-Object { $_ | ConvertFrom-Json } |
  Select-Object time, level, event, traceId, requestId, statusCode, durationMs, url
```
