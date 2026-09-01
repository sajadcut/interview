CREATE TABLE IF NOT EXISTS candidate_consent_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_identity_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  application_id uuid NOT NULL,
  consent_type varchar(64) NOT NULL
    CHECK (consent_type IN ('privacy_disclosure', 'ai_interview', 'recording')),
  notice_version varchar(80) NOT NULL,
  granted boolean NOT NULL,
  granted_at timestamptz,
  withdrawn_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, candidate_identity_id)
    REFERENCES candidate_identities(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, candidate_id)
    REFERENCES candidates(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, application_id)
    REFERENCES applications(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS candidate_consent_receipts_scope_idx
  ON candidate_consent_receipts(
    organization_id, candidate_identity_id, application_id, consent_type, created_at DESC
  );
