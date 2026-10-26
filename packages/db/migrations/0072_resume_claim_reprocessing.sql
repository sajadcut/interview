ALTER TABLE resume_skill_claims
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS resume_skill_claims_current_idx
  ON resume_skill_claims(organization_id, candidate_id, resume_id, is_current)
  WHERE is_current = true;

COMMENT ON COLUMN resume_skill_claims.is_current IS
  'False after reprocessing unless the claim has been literally re-anchored. Historical human reviews remain auditable.';
