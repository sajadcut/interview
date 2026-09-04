ALTER TABLE assessment_execution_jobs
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS worker_id varchar(160),
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code varchar(120);

CREATE INDEX IF NOT EXISTS assessment_execution_jobs_claim_idx
  ON assessment_execution_jobs(state, available_at, created_at)
  WHERE state = 'queued';

CREATE INDEX IF NOT EXISTS assessment_execution_jobs_lease_idx
  ON assessment_execution_jobs(state, lease_expires_at)
  WHERE state = 'claimed';
