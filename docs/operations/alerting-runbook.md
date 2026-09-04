# Alerting runbook

This runbook is the operational response contract for `ops/monitoring/prometheus-alerts.yml`. The policy metadata lives in `ops/monitoring/alerting-contract.v1.json`; changes to alert rules and the contract must be committed together and pass `npm run alerting:check`.

The committed thresholds are **initial operating policy**, not production SLO evidence. A warning is intended for the owning team; a critical alert is intended to page once a real Alertmanager receiver is configured. Receiver URLs, paging credentials, escalation schedules, maintenance calendars, and production delivery evidence remain deployment-specific and must never be committed as secrets.

## Response principles

- Treat a firing alert as evidence to investigate, not permission for destructive automatic remediation.
- Never clear an alert by editing production rows, deleting queue jobs, or force-completing an interview. Repair the underlying condition and let the expression resolve.
- Preserve tenant privacy: alert labels intentionally contain only bounded operational dimensions. Do not add candidate, organization, room, session, worker, token, email, request, or job identifiers as rule labels.
- A critical alert supersedes the warning in the same `alert_family`. Configure Alertmanager inhibition for matching bounded dimensions so operators receive one escalation path instead of duplicate pages.
- If a realtime critical alert can affect active interviews, stop admitting new production interviews according to the incident policy while preserving existing recordings/transcripts and candidate consent semantics.
- Record the incident timeline, deploy/version, first observed time, impacted component, mitigation, and recovery evidence.

A recommended routing shape is:

```yaml
route:
  group_by: [alertname, component, alert_family, queue, media, direction, operation]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: warning-team
  routes:
    - matchers: ['severity="critical"']
      receiver: critical-pager

inhibit_rules:
  - source_matchers: ['severity="critical"']
    target_matchers: ['severity="warning"']
    equal: [alert_family, component, queue, media, direction, operation]
```

The receiver definitions are intentionally absent because real destinations and credentials belong in deployment secret management.

## Common first checks

1. Confirm Prometheus can scrape the expected target and that the alert is not caused by a missing/stale target.
2. Correlate the alert start with the latest deploy, migration, worker rollout, provider incident, or infrastructure change.
3. Check the adjacent metrics described below before restarting anything.
4. Prefer reversible capacity/configuration mitigation over state mutation.
5. After recovery, verify the alert resolves naturally and capture evidence for threshold tuning.

<a id="monitoring-collector"></a>
## Monitoring collector

**Alerts:** `InterviewMetricsCollectionFailed`, `InterviewMetricsSnapshotStale`.

Check `interview_metrics_collection_success`, `interview_metrics_snapshot_age_seconds`, `interview_metrics_collection_errors_total{collector}`, `interview_metrics_collection_duration_seconds`, and `interview_db_up`. A collector failure with `interview_db_up == 0` is primarily a database/dependency incident; a stale snapshot with DB healthy points to collection timeout, API event-loop pressure, or an unexpectedly slow monitoring query.

Verify the API `/metrics` endpoint from the internal network path. Review the metrics collector logs without logging credentials or tenant data. Validate `METRICS_CACHE_TTL_MS` and `METRICS_DB_TIMEOUT_MS` against the documented bounds. Do not increase timeouts indefinitely to hide a slow query.

<a id="api-errors"></a>
## API errors

**Alerts:** `InterviewApiHigh5xxRatio`, `InterviewApiCritical5xxRatio`.

Inspect error and traffic rates by normalized route:

```promql
sum by (route) (rate(interview_http_request_errors_total[5m]))
sum by (route) (rate(interview_http_requests_total[5m]))
```

Correlate with PostgreSQL availability, dependency/provider failures, recent deploys, and queue pressure. For a critical ratio, prioritize rollback/forward-fix of the responsible deploy or dependency isolation. Do not suppress the critical alert simply because traffic is low; the rules already require a minimum request rate.

<a id="api-latency"></a>
## API latency

**Alerts:** `InterviewApiHighP95Latency`, `InterviewApiCriticalP95Latency`.

Start with route-level p95:

```promql
histogram_quantile(
  0.95,
  sum by (route, le) (rate(interview_http_request_duration_seconds_bucket[5m]))
)
```

Then check DB health/cache/deadlocks, in-flight requests, process CPU/memory, and worker/queue pressure. A critical latency alert during otherwise healthy DB/CPU conditions often points to a slow dependency or a route-specific query path. Prefer query/dependency isolation and capacity mitigation over broad timeout increases.

<a id="database"></a>
## Database

**Alerts:** `InterviewDatabaseUnavailable`, `InterviewDatabaseDeadlocks`, `InterviewDatabaseIdleInTransaction`, `InterviewDatabaseCacheHitRatioLow`.

Check:

```promql
interview_db_up
interview_db_connections
increase(interview_db_deadlocks_total[15m])
interview_db_cache_hit_ratio
sum(rate(interview_db_transactions_total[10m]))
```

For unavailability, validate PostgreSQL service health, connectivity, credentials/secret mounting, connection limits, and recent migrations. For deadlocks, inspect PostgreSQL deadlock logs and the participating transaction/query paths; fix transaction ordering rather than retrying indefinitely. For sustained `idle in transaction`, identify the application path holding the transaction and close/fix that path. For cache degradation, inspect query plans, working-set growth, memory pressure, and index usage before changing database memory settings.

A database critical alert can make queue/worker/lifecycle metrics stale or unavailable, so treat downstream monitoring symptoms as secondary until DB health is restored.

<a id="queues"></a>
## Durable queues

**Alerts:** `InterviewQueueBacklogOld`, `InterviewQueueBacklogCritical`, `InterviewQueueExpiredLeases`, `InterviewQueueExpiredLeasesCritical`, `InterviewQueueFailureVolumeHigh`, `InterviewQueueFailureVolumeCritical`.

The `queue` label is bounded to the durable worker families (`ai`, `assessment`, `privacy`, `retention`). Inspect:

```promql
interview_queue_ready_jobs
interview_queue_oldest_ready_age_seconds
interview_queue_active_leases
interview_queue_expired_leases
interview_queue_failures_24h
interview_queue_attempts_observed
```

Determine whether the cause is insufficient worker capacity, repeated lease expiry, downstream provider failure, sandbox/runtime failure, or poison/retryable input. Do **not** mass-retry or delete jobs until the failure class is understood; doing so can amplify provider incidents or bypass privacy/assessment execution semantics. Scale/restart workers only after confirming their lease/retry guarantees remain intact.

<a id="workers"></a>
## Worker availability

**Alerts:** `InterviewQueueReadyWithoutActiveWorker`, `InterviewQueueReadyWithoutWorkerCritical`.

`interview_worker_active_instances` is lease-derived liveness: it proves a worker currently owns an unexpired lease, not that an idle process is alive. When ready work exists with no active lease holder, check the corresponding worker deployment/process supervisor, polling configuration, shared-secret configuration, API reachability, and recent worker logs.

For a critical alert, restore at least one healthy polling worker before manually touching queued jobs. Production infrastructure should additionally provide process/service-level health checks because lease-derived metrics intentionally do not replace a process exporter.

<a id="interview-lifecycle"></a>
## Interview lifecycle

**Alert:** `InterviewLifecycleStalledSessions`.

Review active/stalled session state, the latest persisted media heartbeat, reconnect/error events, and the orchestration path that should complete the session. Do not force a session to `completed` merely to clear the alert; preserve transcript/evidence consistency and candidate-facing recovery semantics. If the stall is caused by realtime infrastructure, follow the realtime section.

<a id="realtime"></a>
## Realtime, LiveKit, whisper.cpp and FFmpeg

**Alerts:** stale media heartbeat, realtime error burst, E2E latency, whisper error/RTF, LiveKit control-plane/packet-loss/RTT, and FFmpeg job failure families.

Use both the API lifecycle metrics and the media-worker `/metrics` endpoint. Key checks include:

```promql
interview_lifecycle_stale_media_sessions
interview_lifecycle_media_errors_15m
histogram_quantile(0.95, sum by (le) (rate(interview_realtime_turn_duration_seconds_bucket{stage="e2e"}[5m])))
histogram_quantile(0.95, sum by (le) (rate(interview_realtime_whisper_realtime_factor_bucket[5m])))
sum by (result) (rate(interview_realtime_whisper_requests_total[5m]))
sum by (result) (rate(interview_realtime_livekit_operations_total[5m]))
sum by (result) (rate(interview_realtime_ffmpeg_jobs_total[5m]))
```

For stale media heartbeats, inspect LiveKit connectivity, TURN/network path, media-worker health, and reconnect events. For whisper failures or high realtime factor, check host CPU/memory, model/runtime configuration, input WAV validity, and timeout saturation. For LiveKit packet loss/RTT, distinguish provider/network degradation from local host saturation. For FFmpeg failures, inspect bounded operation/result/exit-class telemetry and the media input/runtime error.

LiveKit RTP and FFmpeg provider series are intentionally absent until real adapters/runtime telemetry emit measured observations. **Missing pending series must never be replaced with synthetic zeroes just to make dashboards or alerts green.** The committed rules will naturally remain inactive until the corresponding observations exist.

The 1.8-second E2E warning aligns with the current Gate F contract, but a firing/resolved alert is not a substitute for the representative staging benchmark required by `production-readiness.md`.

## Silence, maintenance and recovery

Silences must be scoped, time-bounded, owned, and tied to an incident/change reference. Avoid blanket severity silences. Planned maintenance should silence only the affected `component`/`alert_family` dimensions and expire automatically.

After recovery:

- verify the underlying metrics returned to a healthy range;
- verify warning/critical alerts auto-resolved;
- check for queued retries, stalled sessions, or privacy/assessment jobs needing normal recovery;
- record whether the threshold was useful or noisy;
- tune thresholds only with representative production/staging evidence, not to hide unresolved incidents.

Alert delivery itself is not proven by repository CI. Production readiness requires a deployed Prometheus/Alertmanager/Grafana stack, real receiver tests, paging/escalation evidence, maintenance/silence procedures, and retained incident evidence.
