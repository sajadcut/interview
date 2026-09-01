INSERT INTO permissions (key, description) VALUES
  ('automation.manage', 'Create, review, enable and execute organization automation rules')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS organization_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  default_locale varchar(16) NOT NULL DEFAULT 'en',
  timezone varchar(80) NOT NULL DEFAULT 'UTC',
  hiring_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_key varchar(80) NOT NULL,
  connection_type varchar(80) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'configured'
    CHECK (status IN ('configured', 'verified', 'degraded', 'disabled')),
  credential_reference varchar(512),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_verified_at timestamptz,
  last_error text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider_key, connection_type),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS integration_connections_status_idx
  ON integration_connections(organization_id, status, provider_key);

CREATE TABLE IF NOT EXISTS integration_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL,
  provider_event_id varchar(512) NOT NULL,
  event_type varchar(120) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'received'
    CHECK (state IN ('received', 'processed', 'ignored', 'failed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (organization_id, integration_id, provider_event_id),
  FOREIGN KEY (organization_id, integration_id)
    REFERENCES integration_connections(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(240) NOT NULL,
  description text,
  trigger_type varchar(80) NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type varchar(80) NOT NULL,
  action_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_required boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS automation_rules_enabled_idx
  ON automation_rules(organization_id, enabled, trigger_type);

CREATE TABLE IF NOT EXISTS automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL,
  trigger_reference varchar(512),
  idempotency_key varchar(512) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'approval_required', 'approved', 'succeeded', 'failed', 'cancelled')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, rule_id)
    REFERENCES automation_rules(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS automation_runs_rule_idx
  ON automation_runs(organization_id, rule_id, created_at DESC);

-- Keep production secrets out of application tables: only external secret references are stored.
ALTER TABLE integration_connections
  ADD CONSTRAINT integration_credential_reference_not_inline_secret
  CHECK (
    credential_reference IS NULL
    OR credential_reference !~* '^(sk-|Bearer |Basic )'
  ) NOT VALID;

-- Canonical role grants for the new product surface permission.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'automation.manage'
WHERE r.key IN ('ORGANIZATION_ADMIN', 'HR_MANAGER', 'RECRUITER', 'org_admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;
