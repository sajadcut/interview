CREATE TABLE IF NOT EXISTS ats_job_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_key varchar(80) NOT NULL CHECK (provider_key IN ('greenhouse', 'lever')),
  job_id uuid NOT NULL,
  provider_job_reference varchar(512) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider_key, job_id),
  UNIQUE (organization_id, provider_key, provider_job_reference),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, job_id)
    REFERENCES jobs(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ats_job_links_job_idx
  ON ats_job_links(organization_id, job_id, provider_key);

CREATE TABLE IF NOT EXISTS ats_application_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_key varchar(80) NOT NULL CHECK (provider_key IN ('greenhouse', 'lever')),
  application_id uuid NOT NULL,
  provider_job_reference varchar(512) NOT NULL,
  provider_candidate_reference varchar(512) NOT NULL,
  provider_application_reference varchar(512) NOT NULL,
  remote_stage_reference varchar(512),
  sync_state varchar(32) NOT NULL DEFAULT 'linked'
    CHECK (sync_state IN ('linked', 'degraded', 'outcome_unknown')),
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider_key, application_id),
  UNIQUE (organization_id, provider_key, provider_application_reference),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, application_id)
    REFERENCES applications(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ats_application_links_application_idx
  ON ats_application_links(organization_id, application_id, provider_key);

CREATE TABLE IF NOT EXISTS ats_operation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_key varchar(80) NOT NULL CHECK (provider_key IN ('greenhouse', 'lever')),
  integration_id uuid,
  job_id uuid,
  application_id uuid,
  operation varchar(48) NOT NULL CHECK (operation IN ('verify', 'list_jobs', 'export_application', 'update_stage')),
  state varchar(32) NOT NULL CHECK (state IN ('running', 'succeeded', 'failed', 'outcome_unknown')),
  idempotency_key_hash varchar(64),
  provider_job_reference varchar(512),
  provider_candidate_reference varchar(512),
  provider_application_reference varchar(512),
  error_code varchar(160),
  error_message text,
  retryable boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, integration_id)
    REFERENCES integration_connections(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, job_id)
    REFERENCES jobs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, application_id)
    REFERENCES applications(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ats_operation_attempts_scope_idx
  ON ats_operation_attempts(organization_id, provider_key, operation, created_at DESC);
CREATE INDEX IF NOT EXISTS ats_operation_attempts_application_idx
  ON ats_operation_attempts(organization_id, application_id, created_at DESC)
  WHERE application_id IS NOT NULL;
