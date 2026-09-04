CREATE TABLE IF NOT EXISTS calendar_operation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheduling_request_id uuid NOT NULL,
  provider varchar(64) NOT NULL,
  operation varchar(16) NOT NULL CHECK (operation IN ('reserve', 'cancel')),
  state varchar(32) NOT NULL CHECK (state IN ('succeeded', 'failed')),
  provider_reference varchar(512),
  error_code varchar(160),
  error_message text,
  idempotency_key_hash varchar(64) NOT NULL,
  retryable boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, scheduling_request_id)
    REFERENCES scheduling_requests(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS calendar_operation_attempts_request_idx
  ON calendar_operation_attempts(organization_id, scheduling_request_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS calendar_operation_attempts_failure_idx
  ON calendar_operation_attempts(organization_id, provider, attempted_at DESC)
  WHERE state = 'failed';
