import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for database performance verification");

const requiredIndexes = [
  "applications_org_job_stage_idx",
  "applications_org_candidate_idx",
  "audit_events_org_created_idx",
  "audit_events_org_action_created_idx",
  "audit_events_org_entity_created_idx",
  "candidates_org_name_idx",
  "interview_sessions_application_idx",
  "interview_sessions_status_idx",
  "interview_media_sessions_interview_idx",
  "interview_media_sessions_status_idx",
  "recruitment_events_org_time_idx",
  "screening_sessions_review_queue_idx",
  "scheduling_requests_status_idx",
  "recruitment_notifications_delivery_queue_idx",
  "sessions_expiry_cleanup_idx",
  "refresh_tokens_expiry_cleanup_idx",
  "invitation_tokens_expiry_cleanup_idx",
  "password_reset_tokens_expiry_cleanup_idx",
  "sourcing_runs_status_idx",
  "sourcing_source_attempts_state_idx",
  "maintenance_jobs_state_idx",
] as const;

const sql = postgres(databaseUrl, { max: 1 });
try {
  const rows = await sql<{
    indexname: string;
    indisvalid: boolean;
    indisready: boolean;
  }[]>`
    SELECT
      c.relname AS indexname,
      i.indisvalid,
      i.indisready
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
  `;

  const byName = new Map(rows.map((row) => [row.indexname, row]));
  const missing = requiredIndexes.filter((name) => !byName.has(name));
  const invalid = requiredIndexes.filter((name) => {
    const row = byName.get(name);
    return row ? !row.indisvalid || !row.indisready : false;
  });

  if (missing.length || invalid.length) {
    if (missing.length) console.error(`Missing required indexes: ${missing.join(", ")}`);
    if (invalid.length) console.error(`Invalid/not-ready indexes: ${invalid.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${requiredIndexes.length} operational index contracts are present, valid and ready`);
  }
} finally {
  await sql.end({ timeout: 2 });
}
