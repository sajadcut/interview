ALTER TABLE job_skill_requirements
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE resume_skill_claims
  ADD COLUMN IF NOT EXISTS review_reason text;
CREATE TABLE IF NOT EXISTS resume_skill_claim_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_state varchar(32) NOT NULL,
  new_state varchar(32) NOT NULL CHECK (new_state IN ('confirmed', 'rejected')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 8 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, claim_id)
    REFERENCES resume_skill_claims(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX resume_skill_claim_review_events_claim_idx
  ON resume_skill_claim_review_events(organization_id, claim_id, created_at DESC);

COMMENT ON TABLE resume_skill_claim_review_events IS
  'Auditable human validation of whether a resume claim was extracted correctly. No technical competence verification or score changes.';
COMMENT ON COLUMN job_skill_requirements.is_active IS
  'Versioned tombstone for removed skill requirements; previous versions remain for historical reconstruction.';
