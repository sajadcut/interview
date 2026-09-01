UPDATE candidate_identities
SET temporary = false
WHERE expires_at IS NULL;

ALTER TABLE candidate_identities
  ALTER COLUMN temporary SET DEFAULT false;

ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_candidate_identity_id_fkey;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_candidate_identity_org_fk
  FOREIGN KEY (organization_id, candidate_identity_id)
  REFERENCES candidate_identities(organization_id, id)
  ON DELETE CASCADE;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_principal_identity_scope_chk
  CHECK (
    (principal_type = 'internal' AND user_id IS NOT NULL AND organization_id IS NULL AND candidate_identity_id IS NULL)
    OR
    (principal_type = 'candidate' AND user_id IS NULL AND organization_id IS NOT NULL AND candidate_identity_id IS NOT NULL)
  ) NOT VALID;

ALTER TABLE sessions
  VALIDATE CONSTRAINT sessions_principal_identity_scope_chk;

ALTER TABLE invitation_tokens
  DROP CONSTRAINT IF EXISTS invitation_tokens_candidate_identity_id_fkey;

ALTER TABLE invitation_tokens
  ADD CONSTRAINT invitation_tokens_candidate_identity_org_fk
  FOREIGN KEY (organization_id, candidate_identity_id)
  REFERENCES candidate_identities(organization_id, id)
  ON DELETE CASCADE;
