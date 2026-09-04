# Monitoring and operational metrics

The platform exposes Prometheus text from two operational boundaries:

- the API at `GET /metrics`, for API/process, PostgreSQL, durable queue/worker, and persisted interview lifecycle metrics;
- the media worker at `GET /metrics`, for the versioned realtime metrics contract and measured whisper.cpp telemetry, plus LiveKit/FFmpeg/realtime-orchestrator series once those adapters emit real observations.

Both endpoints are operational surfaces, excluded from the customer-facing API contract. Metrics must not contain organization, candidate, application, session, room, worker, job, token, email, transcript, or other tenant identifiers as labels.

## Collection model

Monitoring is split into three layers:

1. **Runtime API metrics** are kept in-process for HTTP throughput, 5xx responses, in-flight requests, latency histograms, process CPU/memory, and collector failures.
2. **Durable operational metrics** are derived from PostgreSQL on scrape for DB health, durable queues, worker leases, and interview/media lifecycle. Queue and interview state therefore survive API restarts and are not inferred from volatile counters.
3. **Realtime provider/process metrics** follow `contracts/realtime-metrics.v1.json`. The media worker already emits measured whisper.cpp observations. LiveKit RTP/provider data, FFmpeg runtime data, and end-to-end orchestrator timings are emitted only when a real adapter/runtime measures them; missing provider series are never replaced with synthetic zeroes.

Operational API snapshots are coalesced and cached for 5 seconds by default. PostgreSQL collection runs with a statement timeout so a slow monitoring query cannot indefinitely occupy the metrics endpoint.

Optional environment tuning:

```text
METRICS_CACHE_TTL_MS=5000
METRICS_DB_TIMEOUT_MS=2000
```

`METRICS_CACHE_TTL_MS` is bounded to 1-60 seconds and `METRICS_DB_TIMEOUT_MS` to 0.5-10 seconds.

## Metric families

### API/process

- `interview_http_requests_total{method,route}`
- `interview_http_request_errors_total{method,route}`
- `interview_http_responses_total{method,route,status_class}`
- `interview_http_requests_in_flight`
- `interview_http_request_duration_seconds_{bucket,sum,count}`
- `interview_process_uptime_seconds`
- `interview_process_resident_memory_bytes`
- `interview_process_heap_used_bytes`
- `interview_process_cpu_seconds_total{mode}`
- `interview_metrics_collection_errors_total{collector}`
- `interview_metrics_collection_success`
- `interview_metrics_collection_duration_seconds`
- `interview_metrics_snapshot_age_seconds`

Unmatched HTTP paths collapse to `__unmatched__`; UUID, numeric, and long opaque route segments are normalized. This prevents PII/token leakage and cardinality attacks through metric labels.

### PostgreSQL

- `interview_db_up`
- `interview_db_connections{state}`
- `interview_db_size_bytes`
- `interview_db_transactions_total{result}`
- `interview_db_blocks_total{source}`
- `interview_db_cache_hit_ratio`
- `interview_db_deadlocks_total`
- `interview_db_temp_bytes_total`

The DB metrics come from `pg_stat_database`, `pg_stat_activity`, and `pg_database_size(current_database())` using the application database connection.

### Durable queues and workers

The queue label is one of `ai`, `assessment`, `privacy`, or `retention`.

- `interview_queue_jobs{queue,state}`
- `interview_queue_ready_jobs{queue}`
- `interview_queue_oldest_ready_age_seconds{queue}`
- `interview_queue_active_leases{queue}`
- `interview_queue_expired_leases{queue}`
- `interview_queue_attempts_observed{queue}`
- `interview_queue_failures_24h{queue}`
- `interview_worker_active_instances{queue}`
- `interview_worker_last_activity_timestamp_seconds{queue}`

Worker liveness is intentionally defined from durable lease ownership. `active_instances` means distinct worker IDs currently holding an unexpired lease; it does not claim that an idle polling process is alive. Production infrastructure should additionally supervise/scrape each worker process.

### Interview lifecycle

- `interview_lifecycle_sessions{status}`
- `interview_lifecycle_active_sessions`
- `interview_lifecycle_oldest_active_age_seconds`
- `interview_lifecycle_stalled_sessions` (started and incomplete for >2h)
- `interview_lifecycle_started_24h`
- `interview_lifecycle_completed_24h`
- `interview_lifecycle_completed_duration_seconds_avg_24h`
- `interview_lifecycle_final_transcript_segments_15m`
- `interview_lifecycle_evidence_items_15m`
- `interview_lifecycle_media_sessions{status}`
- `interview_lifecycle_active_media_sessions`
- `interview_lifecycle_stale_media_sessions` (connected/degraded with no heartbeat for >90s)
- `interview_lifecycle_media_errors_15m`
- `interview_lifecycle_reconnects_15m`

These metrics are operational aggregates; transcript text, evidence summaries, candidate IDs, room references, and media payloads are never exported.

### Realtime metrics contract

`contracts/realtime-metrics.v1.json` is the source of truth for bounded LiveKit, whisper.cpp, FFmpeg, and realtime-turn metric names, labels, histogram buckets, ownership/source, and wiring status.

The contract includes LiveKit control-plane and RTP metrics; whisper.cpp request/result, duration and realtime-factor metrics; FFmpeg job/process/media metrics; and realtime turn duration/results including the current 1.8-second Gate F E2E bucket.

A metric marked `provider_data_pending` or `recorder_contract` does not imply that production data exists. Alerting and dashboards must tolerate an absent series until a real runtime emits it.

## Scraping and access

A 15-30 second scrape interval is appropriate for both operational endpoints. Keep them on an internal service/network path or protect them at the ingress/service-mesh layer.

Example:

```yaml
scrape_configs:
  - job_name: interview-api
    scrape_interval: 15s
    metrics_path: /metrics
    static_configs:
      - targets: ["interview-api:4100"]

  - job_name: interview-media-worker
    scrape_interval: 15s
    metrics_path: /metrics
    static_configs:
      - targets: ["interview-media-worker:9010"]
```

The exact production service discovery/TLS/auth configuration is deployment-specific.

## Alerting contract

Alerting has a versioned policy contract at `ops/monitoring/alerting-contract.v1.json`. It defines required alert categories, warning/critical routing intent, stable low-cardinality rule labels, threshold families, and runbook anchors. The Prometheus rules live at `ops/monitoring/prometheus-alerts.yml` and must satisfy:

```text
npm run alerting:check
```

`alerting:check` is part of the root test suite. It fails on duplicate or uncontracted rules, missing required categories, invalid severity/`for` semantics, missing runbook anchors, unapproved rule labels, incomplete warning/critical families, unbalanced expressions, or realtime metric references outside `contracts/realtime-metrics.v1.json`.

The committed rules cover:

- metrics collector failure/staleness;
- API 5xx ratio and p95 latency with warning/critical tiers;
- PostgreSQL availability, deadlocks, sustained idle transactions, and cache degradation;
- queue backlog age, expired leases, and failure volume;
- ready work without active lease-holding workers;
- stalled interview sessions;
- stale realtime media heartbeats and persisted error bursts;
- realtime E2E latency, whisper error/RTF, LiveKit control-plane/RTP, and FFmpeg failure families.

Every rule carries only static `severity`, `component`, and `alert_family` labels in addition to bounded labels inherited from its source metric. Runbook URLs point to `docs/operations/alerting-runbook.md`. The runbook defines recommended Alertmanager grouping/inhibition semantics so a critical member of an `alert_family` can supersede its warning without duplicate pages.

Thresholds are **starting operational policy** and must be tuned against representative staging/production traffic. They are not production SLO evidence. Prometheus/Alertmanager/Grafana deployment, receiver credentials, real paging/escalation delivery, maintenance silences, long-term retention, dashboard tuning, and incident-response evidence remain deployment-specific and are not implied by repository CI.
