CREATE UNIQUE INDEX IF NOT EXISTS ai_executions_org_id_uidx
  ON ai_executions(organization_id, id);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  execution_id uuid,
  capability varchar(120) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(32) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'retry_scheduled', 'succeeded', 'failed', 'dead_letter', 'cancelled')),
  priority integer NOT NULL DEFAULT 100 CHECK (priority >= 0 AND priority <= 1000),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1 AND max_attempts <= 10),
  timeout_ms integer NOT NULL DEFAULT 30000 CHECK (timeout_ms >= 250 AND timeout_ms <= 300000),
  retry_base_ms integer NOT NULL DEFAULT 1000 CHECK (retry_base_ms >= 100 AND retry_base_ms <= 60000),
  retry_max_ms integer NOT NULL DEFAULT 60000 CHECK (retry_max_ms >= retry_base_ms AND retry_max_ms <= 600000),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  lease_token uuid,
  worker_id varchar(160),
  idempotency_key varchar(240),
  result jsonb,
  last_error_code varchar(120),
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, execution_id)
    REFERENCES ai_executions(organization_id, id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_org_idempotency_uidx
  ON ai_jobs(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_jobs_claim_idx
  ON ai_jobs(status, available_at, priority, created_at)
  WHERE status IN ('queued', 'retry_scheduled');
CREATE INDEX IF NOT EXISTS ai_jobs_expired_lease_idx
  ON ai_jobs(lease_expires_at)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS ai_jobs_org_status_idx
  ON ai_jobs(organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_job_id uuid NOT NULL,
  event_type varchar(64) NOT NULL,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  worker_id varchar(160),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, ai_job_id)
    REFERENCES ai_jobs(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ai_job_events_job_created_idx
  ON ai_job_events(organization_id, ai_job_id, created_at DESC);
