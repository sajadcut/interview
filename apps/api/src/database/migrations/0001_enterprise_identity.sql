-- Enterprise identity foundation
-- Runs on the existing interview database

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  organization_id uuid,
  email varchar(320) NOT NULL UNIQUE,
  display_name varchar(255) NOT NULL,
  role varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credentials (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  password_hash text,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  session_token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidate_identities (
  id uuid PRIMARY KEY,
  candidate_id uuid,
  temporary_identity varchar(255),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invitation_tokens (
  id uuid PRIMARY KEY,
  candidate_identity_id uuid REFERENCES candidate_identities(id),
  token_hash text NOT NULL,
  otp_hash text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
