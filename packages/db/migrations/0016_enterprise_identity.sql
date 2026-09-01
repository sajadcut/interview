ALTER TABLE users
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users ((lower(email)));

CREATE TABLE IF NOT EXISTS credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  reset_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE candidate_identities
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS temporary boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS candidate_identities_org_id_uq
  ON candidate_identities(organization_id, id);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type varchar(24) NOT NULL CHECK (principal_type IN ('internal', 'candidate')),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_identity_id uuid REFERENCES candidate_identities(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  user_agent_hash varchar(64),
  ip_hash varchar(64),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (principal_type = 'internal' AND user_id IS NOT NULL AND candidate_identity_id IS NULL)
    OR
    (principal_type = 'candidate' AND user_id IS NULL AND organization_id IS NOT NULL AND candidate_identity_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS sessions_user_active_idx
  ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_candidate_active_idx
  ON sessions(organization_id, candidate_identity_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  token_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  rotated_to_id uuid REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_session_idx ON refresh_tokens(session_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens(family_id);

CREATE TABLE IF NOT EXISTS invitation_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_identity_id uuid REFERENCES candidate_identities(id) ON DELETE CASCADE,
  target_email varchar(320) NOT NULL,
  purpose varchar(40) NOT NULL CHECK (
    purpose IN ('candidate_magic_link', 'candidate_otp', 'organization_user_invite')
  ),
  token_hash varchar(64) NOT NULL UNIQUE,
  otp_hash varchar(64),
  role_key varchar(80),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invitation_tokens_org_email_idx
  ON invitation_tokens(organization_id, target_email, expires_at);
CREATE INDEX IF NOT EXISTS invitation_tokens_candidate_idx
  ON invitation_tokens(organization_id, candidate_identity_id, expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
  ON password_reset_tokens(user_id, expires_at);
