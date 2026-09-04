# Realtime Metrics Contract v1

`contracts/realtime-metrics.v1.json` is the canonical, machine-readable telemetry contract for the future production realtime stack. It freezes metric names, Prometheus types, label keys, allowed label values, histogram buckets, ownership, and wiring state before LiveKit/FFmpeg/whisper.cpp production data is admitted.

This contract is telemetry-only. It does not change interview release authority and it does not make Gate F production-ready. Real staging LiveKit/FFmpeg/whisper.cpp evidence and the benchmark requirements in `production-readiness.md` remain mandatory.

## Contract rules

- Namespace: `interview_realtime_*`.
- Contract version: `v1`.
- Organization, candidate, application, interview/session, room, token, user, worker and external-reference identifiers are forbidden as labels.
- Every label has an explicit finite allowlist. Provider text/error messages are never labels.
- Histogram buckets are fixed contract surface. Bucket changes affect dashboards, recording rules and alert evaluation.
- A defined metric does not emit a zero-valued series merely because it exists in the contract. Series appear only after a real observation/gauge update, except contract/readiness gauges.
- Provider telemetry marked `provider_data_pending` must not be populated from guesses, persisted lifecycle approximations or synthetic production values.
- Recorder APIs marked `recorder_contract` are stable integration points for future runtime adapters.

The `1.8` second bucket is intentionally present in `interview_realtime_turn_duration_seconds` so the current Gate F E2E p95 threshold can be evaluated without changing histogram geometry later.

## Wiring state

| State | Meaning |
| --- | --- |
| `wired` | Current code emits this family from a real local execution/readiness path. |
| `recorder_contract` | A validated recorder API exists; a future runtime adapter only needs to pass measured values. |
| `provider_data_pending` | The metric is frozen but must remain absent until the real provider supplies the measurement. |

Current status:

- **whisper.cpp** request count, processing time, WAV duration, realtime factor and empty-transcript count are wired in `services/media-worker/server.py`.
- **LiveKit** control-plane/network/reconnect/session/participant recorders are defined and validated, but provider samples remain absent until the LiveKit runtime is implemented.
- **FFmpeg** readiness is real today; job/process/frames/bytes/realtime-factor recorders are defined and validated, but execution samples remain absent until FFmpeg becomes part of the media pipeline.
- **Cross-pipeline turn timing** recorders exist for `vad_to_stt`, `stt`, `brain`, `tts`, `avatar`, and `e2e`. They remain contract-only until an orchestrator can measure the actual stage boundary.

## Metric families

### Contract and component readiness

- `interview_realtime_contract_info{version}`
- `interview_realtime_component_ready{component}` where component is `livekit`, `whisper`, or `ffmpeg`

Readiness means configured/executable on the media worker; it is not an SLA or proof of a healthy production media path.

### LiveKit

- `interview_realtime_livekit_operations_total{operation,result}`
- `interview_realtime_livekit_operation_duration_seconds{operation}`
- `interview_realtime_livekit_sessions{state}`
- `interview_realtime_livekit_participants{kind}`
- `interview_realtime_livekit_rtt_seconds{media,direction}`
- `interview_realtime_livekit_jitter_seconds{media,direction}`
- `interview_realtime_livekit_packet_loss_ratio{media,direction}`
- `interview_realtime_livekit_reconnects_total{reason}`

RTT, jitter, packet loss, population and reconnect families are provider-data-pending. They must eventually be sourced from LiveKit/WebRTC telemetry, not reverse-engineered from application events.

### whisper.cpp

- `interview_realtime_whisper_requests_total{result}`
- `interview_realtime_whisper_processing_duration_seconds`
- `interview_realtime_whisper_audio_duration_seconds`
- `interview_realtime_whisper_realtime_factor`
- `interview_realtime_whisper_empty_transcripts_total`
- `interview_realtime_whisper_confidence_ratio`

The media worker computes WAV duration using the WAV header and derives realtime factor as `processing_duration / audio_duration`. `confidence_ratio` remains provider-data-pending because the current CLI adapter does not expose a validated confidence contract.

### FFmpeg

- `interview_realtime_ffmpeg_jobs_total{operation,result}`
- `interview_realtime_ffmpeg_processing_duration_seconds{operation}`
- `interview_realtime_ffmpeg_input_duration_seconds{operation}`
- `interview_realtime_ffmpeg_realtime_factor{operation}`
- `interview_realtime_ffmpeg_bytes_total{operation,direction}`
- `interview_realtime_ffmpeg_frames_total{operation,outcome}`
- `interview_realtime_ffmpeg_process_exits_total{operation,exit_class}`
- `interview_realtime_ffmpeg_active_processes{operation}`

Operations are bounded to `ingest`, `transcode`, `mux`, `segment`, and `recording_finalize`. A future FFmpeg adapter should measure from process/progress output and normalize exit conditions into the contract enums.

### Realtime turn SLI

- `interview_realtime_turn_duration_seconds{stage}`
- `interview_realtime_turns_total{result}`

The `e2e` stage boundary is finalized candidate speech available to the orchestrator -> first playable response media available to the candidate. Do not mix transport-only RTT, full candidate utterance length, or background post-processing into this SLI.

## Media-worker scrape endpoint

The media worker exposes Prometheus text at `GET /metrics` using `text/plain; version=0.0.4` and `Cache-Control: no-store`. It contains no transcript text or identifiers and should stay on an internal monitoring network.

```yaml
scrape_configs:
  - job_name: interview-media-worker
    scrape_interval: 15s
    metrics_path: /metrics
    static_configs:
      - targets: ["interview-media-worker:9010"]
```

The API `/metrics` and media-worker `/metrics` are separate scrape targets and may be stored in the same Prometheus.

## Recorder boundary

Future LiveKit adapters call `record_livekit_operation`, `record_livekit_network_sample`, `record_livekit_reconnect`, and `set_livekit_population` with measured provider values. Future FFmpeg adapters call `set_ffmpeg_active_processes` and `record_ffmpeg_job`. The realtime orchestrator calls `record_turn_stage` and `record_turn_result` only at measured stage boundaries.

No adapter may insert example/constants as production telemetry.

## Baseline PromQL

Gate F E2E p95 signal:

```promql
histogram_quantile(0.95, sum by (le) (rate(interview_realtime_turn_duration_seconds_bucket{stage="e2e"}[5m])))
```

whisper.cpp p95 realtime factor:

```promql
histogram_quantile(0.95, sum by (le) (rate(interview_realtime_whisper_realtime_factor_bucket[5m])))
```

LiveKit inbound audio p95 RTT:

```promql
histogram_quantile(0.95, sum by (le) (rate(interview_realtime_livekit_rtt_seconds_bucket{media="audio",direction="inbound"}[5m])))
```

Alert rules live in `ops/monitoring/prometheus-alerts.yml`. Their thresholds are operational signals, not a substitute for the representative 100+ interview Gate F benchmark.

## Contract change policy

A rename, removal, label-key change, label allowlist expansion, type change, semantic-boundary change, or histogram bucket change requires reviewed contract evolution. Additive metrics may stay in v1 only while existing semantics and low-cardinality guarantees remain intact; otherwise create v2 and run both during migration.

CI validates the contract from the API test suite and dependency-free media-worker tests so Python recorder behavior cannot silently diverge from the machine-readable contract.
