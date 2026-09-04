import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import type { DatabaseService } from "../database/database.service";
import { MetricsService } from "./metrics.service";
import { OperationalMetricsService } from "./operational-metrics.service";

const databaseUrl = process.env.AUTH_INTEGRATION_DATABASE_URL;

if (!databaseUrl) {
  test("operational metrics PostgreSQL integration", { skip: "AUTH_INTEGRATION_DATABASE_URL is not configured" }, () => {});
} else {
  test("operational metrics collect API, DB, queue, worker and interview lifecycle families", async () => {
    const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });
    try {
      const runtime = new MetricsService();
      runtime.record("GET", "/health", 200, 4);
      const database = { sql } as unknown as DatabaseService;
      const service = new OperationalMetricsService(database, runtime);
      const text = await service.renderPrometheus();

      assert.match(text, /interview_metrics_collection_success 1/);
      assert.match(text, /interview_db_up 1/);
      assert.match(text, /interview_db_connections\{state="active"\}/);
      assert.match(text, /interview_queue_jobs\{queue="ai",state="queued"\}/);
      assert.match(text, /interview_queue_ready_jobs\{queue="assessment"\}/);
      assert.match(text, /interview_worker_active_instances\{queue="privacy"\}/);
      assert.match(text, /interview_queue_expired_leases\{queue="retention"\}/);
      assert.match(text, /interview_lifecycle_active_sessions /);
      assert.match(text, /interview_lifecycle_stale_media_sessions /);
      assert.match(text, /interview_http_request_duration_seconds_bucket/);
      assert.doesNotMatch(text, /organization_id|candidate_id|worker_id|privacy_request_id/);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
}
