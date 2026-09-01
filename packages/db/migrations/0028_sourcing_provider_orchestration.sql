ALTER TABLE sourcing_runs
  ADD COLUMN IF NOT EXISTS requested_source_type varchar(64) NOT NULL DEFAULT 'internal_talent_pool',
  ADD COLUMN IF NOT EXISTS source_policy_version varchar(80) NOT NULL DEFAULT 'source-policy-v1',
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(200),
  ADD COLUMN IF NOT EXISTS requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS sourcing_runs_idempotency_uq
  ON sourcing_runs(organization_id, job_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE discovered_candidates
  ADD COLUMN IF NOT EXISTS discovery_fingerprint varchar(64),
  ADD COLUMN IF NOT EXISTS source_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source_observed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS discovered_candidates_run_fingerprint_uq
  ON discovered_candidates(organization_id, sourcing_run_id, discovery_fingerprint)
  WHERE discovery_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS sourcing_source_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sourcing_run_id uuid NOT NULL,
  source_type varchar(64) NOT NULL,
  provider_key varchar(120) NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  state varchar(32) NOT NULL CHECK (state IN ('running', 'succeeded', 'failed')),
  idempotency_key varchar(200),
  result_count integer NOT NULL DEFAULT 0,
  provider_reference varchar(512),
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (sourcing_run_id, source_type, attempt_no),
  FOREIGN KEY (organization_id, sourcing_run_id)
    REFERENCES sourcing_runs(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sourcing_source_attempts_run_idx
  ON sourcing_source_attempts(organization_id, sourcing_run_id, attempt_no DESC);
