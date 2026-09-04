import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { escapePrometheusLabel, MetricsService } from "./metrics.service";

const QUEUE_STATES: Record<string, readonly string[]> = {
  ai: ["queued", "running", "retry_scheduled", "succeeded", "failed", "dead_letter", "cancelled"],
  assessment: ["queued", "claimed", "succeeded", "failed", "cancelled"],
  privacy: ["queued", "claimed", "retry_scheduled", "succeeded", "failed", "blocked", "cancelled"],
  retention: ["queued", "claimed", "retry_scheduled", "succeeded", "failed"],
};

interface CachedSnapshot {
  collectedAtMs: number;
  expiresAtMs: number;
  text: string;
}

function boundedEnvInteger(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function labels(values: Record<string, string>): string {
  const rendered = Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}="${escapePrometheusLabel(value)}"`)
    .join(",");
  return rendered ? `{${rendered}}` : "";
}

function pushFamily(lines: string[], name: string, type: "gauge" | "counter", help: string): void {
  lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
}

@Injectable()
export class OperationalMetricsService {
  private readonly cacheTtlMs = boundedEnvInteger("METRICS_CACHE_TTL_MS", 5000, 1000, 60_000);
  private readonly statementTimeoutMs = boundedEnvInteger("METRICS_DB_TIMEOUT_MS", 2000, 500, 10_000);
  private cached: CachedSnapshot | null = null;
  private inFlight: Promise<CachedSnapshot> | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly runtime: MetricsService,
  ) {}

  async renderPrometheus(): Promise<string> {
    const snapshot = await this.getSnapshot();
    const ageSeconds = Math.max(0, Date.now() - snapshot.collectedAtMs) / 1000;
    const runtimeText = this.runtime.renderPrometheus().trimEnd();
    return `${runtimeText}\n${snapshot.text.trimEnd()}\n# HELP interview_metrics_snapshot_age_seconds Age of the cached operational snapshot.\n# TYPE interview_metrics_snapshot_age_seconds gauge\ninterview_metrics_snapshot_age_seconds ${ageSeconds.toFixed(3)}\n`;
  }

  private async getSnapshot(): Promise<CachedSnapshot> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAtMs > now) return this.cached;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.collectSnapshot();
    try {
      this.cached = await this.inFlight;
      return this.cached;
    } finally {
      this.inFlight = null;
    }
  }

  private async collectSnapshot(): Promise<CachedSnapshot> {
    const collectedAtMs = Date.now();
    const startedAt = process.hrtime.bigint();
    try {
      const result = await this.database.sql.begin(async (sql) => {
        await sql`SELECT set_config('statement_timeout', ${String(this.statementTimeoutMs)}, true)`;

        const databaseRows = await sql`
          SELECT
            stats.numbackends::int AS connections_total,
            stats.xact_commit::bigint AS xact_commit,
            stats.xact_rollback::bigint AS xact_rollback,
            stats.blks_read::bigint AS blocks_read,
            stats.blks_hit::bigint AS blocks_hit,
            stats.deadlocks::bigint AS deadlocks,
            stats.temp_bytes::bigint AS temp_bytes,
            pg_database_size(current_database())::bigint AS database_size_bytes,
            (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS connections_active,
            (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle') AS connections_idle,
            (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction') AS connections_idle_in_transaction
          FROM pg_stat_database stats
          WHERE stats.datname = current_database()
          LIMIT 1
        `;

        const queueRows = await sql`
          WITH jobs AS (
            SELECT
              'ai'::text AS queue,
              status::text AS state,
              available_at,
              lease_expires_at,
              worker_id,
              attempt_count,
              updated_at,
              (status IN ('queued', 'retry_scheduled')) AS ready_state,
              (status = 'running') AS leased_state,
              (status IN ('failed', 'dead_letter')) AS failure_state
            FROM ai_jobs
            UNION ALL
            SELECT
              'assessment'::text,
              state::text,
              available_at,
              lease_expires_at,
              worker_id,
              attempt_count,
              updated_at,
              (state = 'queued'),
              (state = 'claimed'),
              (state = 'failed')
            FROM assessment_execution_jobs
            UNION ALL
            SELECT
              'privacy'::text,
              state::text,
              available_at,
              lease_expires_at,
              worker_id,
              attempt_count,
              updated_at,
              (state IN ('queued', 'retry_scheduled')),
              (state = 'claimed'),
              (state = 'failed')
            FROM privacy_deletion_jobs
            UNION ALL
            SELECT
              'retention'::text,
              state::text,
              available_at,
              lease_expires_at,
              worker_id,
              attempt_count,
              updated_at,
              (state IN ('queued', 'retry_scheduled')),
              (state = 'claimed'),
              (state = 'failed')
            FROM retention_jobs
          ),
          queue_names(queue) AS (
            VALUES ('ai'::text), ('assessment'::text), ('privacy'::text), ('retention'::text)
          ),
          state_agg AS (
            SELECT queue, jsonb_object_agg(state, total ORDER BY state) AS state_counts
            FROM (
              SELECT queue, state, count(*)::int AS total
              FROM jobs
              GROUP BY queue, state
            ) counts
            GROUP BY queue
          ),
          summary AS (
            SELECT
              queue,
              count(*) FILTER (WHERE ready_state AND available_at <= now())::int AS ready_jobs,
              COALESCE(
                EXTRACT(EPOCH FROM (now() - (min(available_at) FILTER (WHERE ready_state AND available_at <= now())))),
                0
              )::float8 AS oldest_ready_age_seconds,
              count(*) FILTER (
                WHERE leased_state AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
              )::int AS active_leases,
              count(*) FILTER (
                WHERE leased_state AND lease_expires_at IS NOT NULL AND lease_expires_at <= now()
              )::int AS expired_leases,
              count(DISTINCT worker_id) FILTER (
                WHERE leased_state AND worker_id IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
              )::int AS active_workers,
              COALESCE(
                EXTRACT(EPOCH FROM (max(updated_at) FILTER (WHERE leased_state AND worker_id IS NOT NULL))),
                0
              )::float8 AS last_worker_activity_timestamp_seconds,
              COALESCE(sum(attempt_count), 0)::bigint AS attempts_sum,
              count(*) FILTER (
                WHERE failure_state AND updated_at >= now() - interval '24 hours'
              )::int AS failures_24h
            FROM jobs
            GROUP BY queue
          )
          SELECT
            names.queue,
            COALESCE(states.state_counts, '{}'::jsonb) AS state_counts,
            COALESCE(summary.ready_jobs, 0)::int AS ready_jobs,
            COALESCE(summary.oldest_ready_age_seconds, 0)::float8 AS oldest_ready_age_seconds,
            COALESCE(summary.active_leases, 0)::int AS active_leases,
            COALESCE(summary.expired_leases, 0)::int AS expired_leases,
            COALESCE(summary.active_workers, 0)::int AS active_workers,
            COALESCE(summary.last_worker_activity_timestamp_seconds, 0)::float8 AS last_worker_activity_timestamp_seconds,
            COALESCE(summary.attempts_sum, 0)::bigint AS attempts_sum,
            COALESCE(summary.failures_24h, 0)::int AS failures_24h
          FROM queue_names names
          LEFT JOIN state_agg states USING (queue)
          LEFT JOIN summary USING (queue)
          ORDER BY names.queue
        `;

        const interviewRows = await sql`
          SELECT
            COALESCE((
              SELECT jsonb_object_agg(status, total ORDER BY status)
              FROM (
                SELECT status, count(*)::int AS total
                FROM interview_sessions
                GROUP BY status
              ) session_counts
            ), '{}'::jsonb) AS session_states,
            COALESCE((
              SELECT jsonb_object_agg(status, total ORDER BY status)
              FROM (
                SELECT status, count(*)::int AS total
                FROM interview_media_sessions
                GROUP BY status
              ) media_counts
            ), '{}'::jsonb) AS media_states,
            (SELECT count(*)::int FROM interview_sessions WHERE started_at IS NOT NULL AND completed_at IS NULL) AS active_sessions,
            COALESCE((
              SELECT EXTRACT(EPOCH FROM (now() - min(started_at)))::float8
              FROM interview_sessions
              WHERE started_at IS NOT NULL AND completed_at IS NULL
            ), 0)::float8 AS oldest_active_age_seconds,
            (SELECT count(*)::int FROM interview_sessions WHERE started_at IS NOT NULL AND completed_at IS NULL AND started_at < now() - interval '2 hours') AS stalled_sessions,
            (SELECT count(*)::int FROM interview_sessions WHERE started_at >= now() - interval '24 hours') AS started_24h,
            (SELECT count(*)::int FROM interview_sessions WHERE completed_at >= now() - interval '24 hours') AS completed_24h,
            COALESCE((
              SELECT avg(EXTRACT(EPOCH FROM (completed_at - started_at)))::float8
              FROM interview_sessions
              WHERE completed_at >= now() - interval '24 hours'
                AND started_at IS NOT NULL
                AND completed_at >= started_at
            ), 0)::float8 AS completed_duration_avg_24h,
            (SELECT count(*)::int FROM interview_transcript_segments WHERE is_final = true AND created_at >= now() - interval '15 minutes') AS final_transcript_segments_15m,
            (SELECT count(*)::int FROM interview_evidence WHERE created_at >= now() - interval '15 minutes') AS evidence_items_15m,
            (SELECT count(*)::int FROM interview_media_sessions WHERE status IN ('connecting', 'connected', 'degraded')) AS active_media_sessions,
            (SELECT count(*)::int FROM interview_media_sessions WHERE status IN ('connected', 'degraded') AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval '90 seconds')) AS stale_media_sessions,
            (SELECT count(*)::int FROM interview_media_events WHERE event_type = 'error' AND occurred_at >= now() - interval '15 minutes') AS media_errors_15m,
            (SELECT count(*)::int FROM interview_media_events WHERE event_type = 'reconnected' AND occurred_at >= now() - interval '15 minutes') AS reconnects_15m
        `;

        return {
          database: databaseRows[0] as Record<string, unknown> | undefined,
          queues: queueRows as unknown as Array<Record<string, unknown>>,
          interview: interviewRows[0] as Record<string, unknown> | undefined,
        };
      });

      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      return {
        collectedAtMs,
        expiresAtMs: collectedAtMs + this.cacheTtlMs,
        text: this.renderOperational(result.database, result.queues, result.interview, durationSeconds),
      };
    } catch {
      this.runtime.recordCollectionError("operational_db");
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      return {
        collectedAtMs,
        expiresAtMs: collectedAtMs + this.cacheTtlMs,
        text: this.renderFailure(durationSeconds),
      };
    }
  }

  private renderFailure(durationSeconds: number): string {
    const lines: string[] = [];
    pushFamily(lines, "interview_metrics_collection_success", "gauge", "Whether the latest operational DB snapshot succeeded.");
    lines.push("interview_metrics_collection_success 0");
    pushFamily(lines, "interview_metrics_collection_duration_seconds", "gauge", "Duration of the latest operational metrics collection.");
    lines.push(`interview_metrics_collection_duration_seconds ${durationSeconds.toFixed(6)}`);
    pushFamily(lines, "interview_db_up", "gauge", "Whether PostgreSQL operational metrics were collected successfully.");
    lines.push("interview_db_up 0");
    return `${lines.join("\n")}\n`;
  }

  private renderOperational(
    database: Record<string, unknown> | undefined,
    queues: Array<Record<string, unknown>>,
    interview: Record<string, unknown> | undefined,
    durationSeconds: number,
  ): string {
    const lines: string[] = [];
    pushFamily(lines, "interview_metrics_collection_success", "gauge", "Whether the latest operational DB snapshot succeeded.");
    lines.push("interview_metrics_collection_success 1");
    pushFamily(lines, "interview_metrics_collection_duration_seconds", "gauge", "Duration of the latest operational metrics collection.");
    lines.push(`interview_metrics_collection_duration_seconds ${durationSeconds.toFixed(6)}`);

    const db = database ?? {};
    const blocksHit = asNumber(db.blocks_hit);
    const blocksRead = asNumber(db.blocks_read);
    const blockTotal = blocksHit + blocksRead;
    pushFamily(lines, "interview_db_up", "gauge", "Whether PostgreSQL operational metrics were collected successfully.");
    lines.push("interview_db_up 1");
    pushFamily(lines, "interview_db_connections", "gauge", "Current PostgreSQL connections by state.");
    const totalConnections = asNumber(db.connections_total);
    const activeConnections = asNumber(db.connections_active);
    const idleConnections = asNumber(db.connections_idle);
    const idleTransactionConnections = asNumber(db.connections_idle_in_transaction);
    lines.push(`interview_db_connections${labels({ state: "active" })} ${activeConnections}`);
    lines.push(`interview_db_connections${labels({ state: "idle" })} ${idleConnections}`);
    lines.push(`interview_db_connections${labels({ state: "idle_in_transaction" })} ${idleTransactionConnections}`);
    lines.push(
      `interview_db_connections${labels({ state: "other" })} ${Math.max(0, totalConnections - activeConnections - idleConnections - idleTransactionConnections)}`,
    );
    pushFamily(lines, "interview_db_size_bytes", "gauge", "Current PostgreSQL database size in bytes.");
    lines.push(`interview_db_size_bytes ${asNumber(db.database_size_bytes)}`);
    pushFamily(lines, "interview_db_transactions_total", "counter", "PostgreSQL transactions since statistics reset.");
    lines.push(`interview_db_transactions_total${labels({ result: "commit" })} ${asNumber(db.xact_commit)}`);
    lines.push(`interview_db_transactions_total${labels({ result: "rollback" })} ${asNumber(db.xact_rollback)}`);
    pushFamily(lines, "interview_db_blocks_total", "counter", "PostgreSQL block reads and cache hits since statistics reset.");
    lines.push(`interview_db_blocks_total${labels({ source: "disk_read" })} ${blocksRead}`);
    lines.push(`interview_db_blocks_total${labels({ source: "cache_hit" })} ${blocksHit}`);
    pushFamily(lines, "interview_db_cache_hit_ratio", "gauge", "PostgreSQL shared block cache hit ratio.");
    lines.push(`interview_db_cache_hit_ratio ${blockTotal > 0 ? (blocksHit / blockTotal).toFixed(6) : "1"}`);
    pushFamily(lines, "interview_db_deadlocks_total", "counter", "PostgreSQL deadlocks since statistics reset.");
    lines.push(`interview_db_deadlocks_total ${asNumber(db.deadlocks)}`);
    pushFamily(lines, "interview_db_temp_bytes_total", "counter", "PostgreSQL temporary bytes written since statistics reset.");
    lines.push(`interview_db_temp_bytes_total ${asNumber(db.temp_bytes)}`);

    pushFamily(lines, "interview_queue_jobs", "gauge", "Durable queue jobs by queue and current state.");
    pushFamily(lines, "interview_queue_ready_jobs", "gauge", "Jobs currently eligible to be claimed.");
    pushFamily(lines, "interview_queue_oldest_ready_age_seconds", "gauge", "Age of the oldest currently eligible job.");
    pushFamily(lines, "interview_queue_active_leases", "gauge", "Unexpired active worker leases.");
    pushFamily(lines, "interview_queue_expired_leases", "gauge", "Claimed jobs whose worker lease has expired.");
    pushFamily(lines, "interview_queue_attempts_observed", "gauge", "Sum of persisted attempt counts across current durable jobs.");
    pushFamily(lines, "interview_queue_failures_24h", "gauge", "Persisted terminal queue failures updated during the last 24 hours.");
    pushFamily(lines, "interview_worker_active_instances", "gauge", "Distinct worker IDs holding an unexpired lease.");
    pushFamily(lines, "interview_worker_last_activity_timestamp_seconds", "gauge", "Last persisted leased-worker activity timestamp; zero when none exists.");

    for (const row of queues) {
      const queue = String(row.queue ?? "unknown");
      const stateCounts = asRecord(row.state_counts);
      for (const state of QUEUE_STATES[queue] ?? Object.keys(stateCounts).slice(0, 32)) {
        lines.push(`interview_queue_jobs${labels({ queue, state })} ${asNumber(stateCounts[state])}`);
      }
      lines.push(`interview_queue_ready_jobs${labels({ queue })} ${asNumber(row.ready_jobs)}`);
      lines.push(
        `interview_queue_oldest_ready_age_seconds${labels({ queue })} ${asNumber(row.oldest_ready_age_seconds).toFixed(3)}`,
      );
      lines.push(`interview_queue_active_leases${labels({ queue })} ${asNumber(row.active_leases)}`);
      lines.push(`interview_queue_expired_leases${labels({ queue })} ${asNumber(row.expired_leases)}`);
      lines.push(`interview_queue_attempts_observed${labels({ queue })} ${asNumber(row.attempts_sum)}`);
      lines.push(`interview_queue_failures_24h${labels({ queue })} ${asNumber(row.failures_24h)}`);
      lines.push(`interview_worker_active_instances${labels({ queue })} ${asNumber(row.active_workers)}`);
      lines.push(
        `interview_worker_last_activity_timestamp_seconds${labels({ queue })} ${asNumber(row.last_worker_activity_timestamp_seconds).toFixed(3)}`,
      );
    }

    const lifecycle = interview ?? {};
    pushFamily(lines, "interview_lifecycle_sessions", "gauge", "Interview sessions by persisted lifecycle status.");
    for (const [status, count] of Object.entries(asRecord(lifecycle.session_states)).sort(([a], [b]) => a.localeCompare(b)).slice(0, 32)) {
      lines.push(`interview_lifecycle_sessions${labels({ status: status.slice(0, 64) })} ${asNumber(count)}`);
    }
    pushFamily(lines, "interview_lifecycle_media_sessions", "gauge", "Realtime media sessions by persisted status.");
    for (const [status, count] of Object.entries(asRecord(lifecycle.media_states)).sort(([a], [b]) => a.localeCompare(b)).slice(0, 16)) {
      lines.push(`interview_lifecycle_media_sessions${labels({ status: status.slice(0, 64) })} ${asNumber(count)}`);
    }
    const scalarLifecycleMetrics: Array<[string, string, unknown]> = [
      ["interview_lifecycle_active_sessions", "Interview sessions that started and have not completed.", lifecycle.active_sessions],
      ["interview_lifecycle_oldest_active_age_seconds", "Age of the oldest started but incomplete interview session.", lifecycle.oldest_active_age_seconds],
      ["interview_lifecycle_stalled_sessions", "Started interview sessions still incomplete after two hours.", lifecycle.stalled_sessions],
      ["interview_lifecycle_started_24h", "Interview sessions started during the last 24 hours.", lifecycle.started_24h],
      ["interview_lifecycle_completed_24h", "Interview sessions completed during the last 24 hours.", lifecycle.completed_24h],
      ["interview_lifecycle_completed_duration_seconds_avg_24h", "Average completed interview duration during the last 24 hours.", lifecycle.completed_duration_avg_24h],
      ["interview_lifecycle_final_transcript_segments_15m", "Final transcript segments persisted during the last 15 minutes.", lifecycle.final_transcript_segments_15m],
      ["interview_lifecycle_evidence_items_15m", "Interview evidence items persisted during the last 15 minutes.", lifecycle.evidence_items_15m],
      ["interview_lifecycle_active_media_sessions", "Realtime media sessions currently connecting, connected or degraded.", lifecycle.active_media_sessions],
      ["interview_lifecycle_stale_media_sessions", "Connected or degraded media sessions without a heartbeat for 90 seconds.", lifecycle.stale_media_sessions],
      ["interview_lifecycle_media_errors_15m", "Realtime media error events during the last 15 minutes.", lifecycle.media_errors_15m],
      ["interview_lifecycle_reconnects_15m", "Realtime media reconnect events during the last 15 minutes.", lifecycle.reconnects_15m],
    ];
    for (const [name, help, value] of scalarLifecycleMetrics) {
      pushFamily(lines, name, "gauge", help);
      lines.push(`${name} ${asNumber(value).toFixed(name.endsWith("seconds_avg_24h") || name.endsWith("age_seconds") ? 3 : 0)}`);
    }

    return `${lines.join("\n")}\n`;
  }
}
