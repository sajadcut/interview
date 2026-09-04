-- Read-optimized indexes for Prometheus operational monitoring queries.
-- These indexes intentionally avoid tenant/candidate/worker identifiers in exported metrics.

CREATE INDEX IF NOT EXISTS ai_jobs_monitoring_state_updated_idx
  ON ai_jobs(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS assessment_execution_jobs_monitoring_state_updated_idx
  ON assessment_execution_jobs(state, updated_at DESC);

CREATE INDEX IF NOT EXISTS privacy_deletion_jobs_monitoring_state_updated_idx
  ON privacy_deletion_jobs(state, updated_at DESC);

CREATE INDEX IF NOT EXISTS retention_jobs_monitoring_state_updated_idx
  ON retention_jobs(state, updated_at DESC);

CREATE INDEX IF NOT EXISTS interview_sessions_monitoring_status_updated_idx
  ON interview_sessions(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS interview_sessions_monitoring_active_idx
  ON interview_sessions(started_at)
  WHERE started_at IS NOT NULL AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS interview_sessions_monitoring_completed_idx
  ON interview_sessions(completed_at DESC)
  WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS interview_media_sessions_monitoring_status_heartbeat_idx
  ON interview_media_sessions(status, last_heartbeat_at);

CREATE INDEX IF NOT EXISTS interview_media_events_monitoring_type_occurred_idx
  ON interview_media_events(event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS interview_transcript_segments_monitoring_created_idx
  ON interview_transcript_segments(created_at DESC)
  WHERE is_final = true;

CREATE INDEX IF NOT EXISTS interview_evidence_monitoring_created_idx
  ON interview_evidence(created_at DESC);
