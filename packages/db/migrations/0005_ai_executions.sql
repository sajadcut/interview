CREATE TABLE IF NOT EXISTS ai_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  capability varchar(120) NOT NULL,
  provider varchar(80) NOT NULL,
  model varchar(160) NOT NULL,
  prompt_version varchar(120) NOT NULL,
  status varchar(32) NOT NULL,
  input_references jsonb,
  structured_output jsonb,
  prompt_tokens integer,
  completion_tokens integer,
  latency_ms integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_executions_org_created_idx ON ai_executions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_executions_capability_idx ON ai_executions(organization_id, capability);
