CREATE TABLE IF NOT EXISTS auth_rate_limits (
  scope varchar(48) NOT NULL,
  key_hash varchar(64) NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key_hash)
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_blocked_idx
  ON auth_rate_limits(blocked_until)
  WHERE blocked_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS candidate_invitation_contexts (
  invitation_token_id uuid PRIMARY KEY REFERENCES invitation_tokens(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, application_id)
    REFERENCES applications(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, candidate_id)
    REFERENCES candidates(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS candidate_invitation_context_application_idx
  ON candidate_invitation_contexts(organization_id, application_id);

CREATE TABLE IF NOT EXISTS candidate_session_contexts (
  session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, application_id)
    REFERENCES applications(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, candidate_id)
    REFERENCES candidates(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS candidate_session_context_application_idx
  ON candidate_session_contexts(organization_id, application_id);
