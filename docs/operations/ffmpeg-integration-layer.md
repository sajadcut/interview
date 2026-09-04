# FFmpeg Integration Layer v1

## Scope

`services/media-worker/ffmpeg_layer.py` is the process boundary for future self-hosted FFmpeg work in the realtime media stack. It is intentionally usable and testable without installing FFmpeg.

The layer owns deterministic command construction, shell-free process spawning, process-group lifecycle management, timeout/cancellation, terminate-then-kill escalation, bounded diagnostics, output validation, temporary workspace cleanup and low-cardinality FFmpeg telemetry.

It does **not** claim real FFmpeg runtime evidence, codec availability, media quality, hardware throughput or Gate F readiness. Those require a real deployment host and representative media.

## Contract

Source of truth:

```text
contracts/ffmpeg-integration.v1.json
```

Contract version:

```text
ffmpeg-integration.v1
```

Allowed operations are intentionally finite and match Realtime Metrics Contract v1:

```text
ingest
transcode
mux
segment
recording_finalize
```

## Command builder

`FFmpegCommandBuilder` returns an argument vector, never a shell command string. Global policy is:

```text
-hide_banner
-nostdin
-loglevel error
-y
```

`subprocess.Popen(..., shell=False)` is mandatory. Candidate/user text is never interpolated into a shell command. All input/output paths must resolve inside the owned job workspace, inputs must exist, and outputs may not overwrite inputs.

Current fixed profiles:

| Operation | Profile |
|---|---|
| ingest | first audio stream → mono 16 kHz PCM16 WAV |
| transcode | H.264 + AAC + `faststart` |
| mux | copy video + AAC audio + shortest stream |
| segment | stream copy + segment muxer + reset timestamps |
| recording_finalize | stream copy + `faststart` |

These profiles are media infrastructure mechanics, not interview intelligence or hiring logic.

## Process management

`FFmpegProcessRunner` creates a dedicated process group/session where supported.

Defaults:

```text
timeout                         120 seconds
timeout range                   0.05 .. 600 seconds
termination grace              2 seconds
termination grace range         0.05 .. 10 seconds
poll interval                   20 ms
stderr diagnostic tail          max 8192 bytes
stdin                           disabled
shell                           disabled
```

Timeout/cancellation lifecycle:

```text
running process group
→ SIGTERM / terminate
→ bounded grace wait
→ SIGKILL / kill when still alive
→ bounded final wait
```

The runner performs a final liveness check in `finally`, so it does not intentionally return while its process is still running.

## Error handling

Stable codes:

```text
invalid_request
executable_not_found
process_start_failed
process_timeout
process_cancelled
process_failed
output_missing
output_empty
cleanup_failed
```

`FFmpegError` exposes stable `code`, `result`, `retryable`, `exit_code` and an optional internal `diagnostic`. The exception message itself is generic. The diagnostic is a bounded stderr tail; temporary workspace paths are replaced with `<workspace>` and control characters are normalized.

## Workspace and cleanup

`FFmpegWorkspace` creates an owned temporary directory and rejects absolute/traversal child paths. It can stage byte inputs and create nested output paths.

Cleanup runs on success, exception, timeout and cancellation. Read-only paths are made writable and removal is retried. A cleanup failure is not allowed to replace the primary process exception; on runtimes supporting exception notes it is attached as secondary context instead.

`FFMPEG_WORK_ROOT` may place temporary jobs on a dedicated ephemeral volume.

## Configuration

```env
FFMPEG_ENABLED=false
FFMPEG_CLI=ffmpeg
FFMPEG_TIMEOUT_SECONDS=120
FFMPEG_TERMINATION_GRACE_SECONDS=2
FFMPEG_WORK_ROOT=
```

Keeping `FFMPEG_ENABLED=false` is valid on developer and CI machines that do not have FFmpeg installed.

## Telemetry

The runner uses only existing bounded Realtime Metrics Contract v1 labels:

```text
interview_realtime_ffmpeg_jobs_total
interview_realtime_ffmpeg_processing_duration_seconds
interview_realtime_ffmpeg_input_duration_seconds
interview_realtime_ffmpeg_realtime_factor
interview_realtime_ffmpeg_bytes_total
interview_realtime_ffmpeg_process_exits_total
interview_realtime_ffmpeg_active_processes
```

No candidate, organization, job, session, filename, path, URL, token or other unbounded identifier is added as a metric label.

## Validation without FFmpeg

CI does not install or invoke FFmpeg for this contract.

`services/media-worker/test/test_ffmpeg_layer.py` tests command construction directly and uses the active Python interpreter as a fake subprocess for successful execution, nonzero exit, timeout, in-flight cancellation, missing/empty outputs, bounded diagnostics and cleanup.

Contract consistency is enforced by:

```text
npm run ffmpeg:contract:check
```

That check cross-validates the FFmpeg contract, Realtime Metrics allowlists, environment knobs, process-safety markers and dependency-free tests.

## Production evidence boundary

A green contract test proves the integration semantics, not FFmpeg itself. A real target host still needs pinned build/codec evidence, CPU/GPU/memory measurements, corrupted-input tests, disk-pressure behavior, representative recording/transcode/segment throughput, realtime factor/tail latency, output-integrity checks, real telemetry/alerts and the recovery evidence required by `production-readiness.md`.

Do not mark real FFmpeg runtime telemetry or Gate F as satisfied from fake-process tests.
