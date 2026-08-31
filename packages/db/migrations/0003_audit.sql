CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_type varchar(32) NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(160) NOT NULL,
  entity_type varchar(120) NOT NULL,
  entity_id varchar(160),
  reason text,
  before jsonb,
  after jsonb,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_org_created_idx ON audit_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_entity_idx ON audit_events(organization_id, entity_type, entity_id);
