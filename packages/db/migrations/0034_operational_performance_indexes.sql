-- Additive indexes for recurring operational scans and tenant-scoped review queues.
-- Keep these narrow and aligned with the query shapes used by maintenance, audit,
-- screening, scheduling, notification and sourcing workflows.

CREATE INDEX IF NOT EXISTS audit_events_org_action_created_idx
  ON audit_events(organization_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_org_entity_created_idx
  ON audit_events(organization_id, entity_type, created_at DESC);

CREATE INDEX IF NOT EXISTS screening_sessions_review_queue_idx
  ON screening_sessions(organization_id, review_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS scheduling_requests_status_idx
  ON scheduling_requests(organization_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS recruitment_notifications_delivery_queue_idx
  ON recruitment_notifications(organization_id, status, scheduled_for, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS sourcing_runs_status_idx
  ON sourcing_runs(organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS sourcing_source_attempts_state_idx
  ON sourcing_source_attempts(organization_id, state, started_at DESC);

CREATE INDEX IF NOT EXISTS maintenance_jobs_state_idx
  ON maintenance_jobs(organization_id, state, started_at DESC);

CREATE INDEX IF NOT EXISTS interview_media_sessions_status_idx
  ON interview_media_sessions(organization_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS interview_sessions_status_idx
  ON interview_sessions(organization_id, status, updated_at DESC);
