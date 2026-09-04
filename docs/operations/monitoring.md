# Monitoring and operational metrics

The API exposes Prometheus text format at `GET /metrics`. The endpoint is excluded from the public OpenAPI contract and returns aggregate operational data only: no organization, candidate, job, worker, token, email, transcript, or other tenant identifiers are labels.

## Collection model

Monitoring is split into two layers:

1. **Runtime API metrics** are kept in-process for HTTP throughput, 5xx responses, in-flight requests, latency histograms, process CPU/memory, and collector failures.
2. **Durable operational metrics** are derived from PostgreSQL on scrape for DB health, durable queues, worker leases, and interview/media lifecycle. This means queue and interview state survive API restarts and are not inferred from volatile counters.

Operational snapshots are coalesced and cached for 5 seconds by default. PostgreSQL collection runs with a statement timeout so a slow monitoring query cannot indefinitely occupy the metrics endpoint.

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

Unmatched HTTP paths collapse to `__unmatched__`; UUID, numeric and long opaque route segments are normalized. This prevents PII/token leakage and cardinality attacks through metric labels.

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

Worker liveness is intentionally defined from durable lease ownership. `active_instances` means distinct worker IDs currently holding an unexpired lease; it does not claim that an idle polling process is alive. For process-level worker liveness, deployment infrastructure should additionally scrape/supervise each worker process.

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

## Scraping and access

A 15-30 second Prometheus scrape interval is appropriate. Keep `/metrics` on an internal service/network path or protect it at the ingress/service-mesh layer; it is an operational endpoint, not a customer-facing API. The endpoint sets `Cache-Control: no-store` and is excluded from generated API contracts.

Example Prometheus job:

```yaml
scrape_configs:
  - job_name: interview-api
    scrape_interval: 15s
    metrics_path: /metrics
    static_configs:
      - targets: ["interview-api:4100"]
```

Baseline alert rules are committed at `ops/monitoring/prometheus-alerts.yml`. Thresholds are starting points and must be tuned against real production traffic and SLOs. Alert delivery, Prometheus/Alertmanager/Grafana deployment, long-term metric retention, and worker process exporters remain deployment-specific and are not implied by code-level validation.
