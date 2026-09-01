CREATE TABLE IF NOT EXISTS legal_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_id uuid,
  entity_type varchar(80),
  entity_id uuid,
  reason text NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
  placed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  released_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (candidate_id IS NOT NULL OR (entity_type IS NOT NULL AND entity_id IS NOT NULL)),
  FOREIGN KEY (organization_id, candidate_id)
    REFERENCES candidates(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS legal_holds_candidate_active_idx
  ON legal_holds(organization_id, candidate_id, status)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS legal_holds_entity_active_idx
  ON legal_holds(organization_id, entity_type, entity_id, status)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS maintenance_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  job_type varchar(48) NOT NULL CHECK (
    job_type IN ('retention', 'privacy_deletion', 'session_cleanup', 'audit_export')
  ),
  idempotency_key varchar(200),
  state varchar(24) NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'succeeded', 'failed')),
  dry_run boolean NOT NULL DEFAULT true,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, job_type, idempotency_key)
);
CREATE INDEX IF NOT EXISTS maintenance_jobs_org_type_idx
  ON maintenance_jobs(organization_id, job_type, created_at DESC);

CREATE TABLE IF NOT EXISTS privacy_deletion_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  privacy_request_id uuid NOT NULL,
  candidate_reference_hash varchar(64) NOT NULL,
  requested_at timestamptz NOT NULL,
  executed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  deletion_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, privacy_request_id),
  UNIQUE (organization_id, id)
);

CREATE INDEX IF NOT EXISTS sessions_expiry_cleanup_idx
  ON sessions(expires_at, revoked_at);
CREATE INDEX IF NOT EXISTS refresh_tokens_expiry_cleanup_idx
  ON refresh_tokens(expires_at, revoked_at);
CREATE INDEX IF NOT EXISTS invitation_tokens_expiry_cleanup_idx
  ON invitation_tokens(expires_at, consumed_at);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_cleanup_idx
  ON password_reset_tokens(expires_at, consumed_at);
