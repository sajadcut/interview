ALTER TABLE resume_skill_claims
  ADD COLUMN IF NOT EXISTS review_version integer NOT NULL DEFAULT 0
    CHECK (review_version >= 0);
ALTER TABLE resume_skill_claim_review_events
  ADD COLUMN IF NOT EXISTS review_version integer;
ALTER TABLE resume_skill_claim_review_events
  ADD COLUMN IF NOT EXISTS previous_skill_key varchar(160);
ALTER TABLE resume_skill_claim_review_events
  ADD COLUMN IF NOT EXISTS new_skill_key varchar(160);
WITH ordered AS (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id, claim_id ORDER BY created_at, id
  )::integer AS version
  FROM resume_skill_claim_review_events
)
UPDATE resume_skill_claim_review_events e
SET review_version = ordered.version
FROM ordered WHERE e.id = ordered.id AND e.review_version IS NULL;
UPDATE resume_skill_claims rc
SET review_version = (
  SELECT count(*)::integer FROM resume_skill_claim_review_events e
  WHERE e.organization_id = rc.organization_id AND e.claim_id = rc.id
)
WHERE rc.review_version = 0 AND EXISTS (
  SELECT 1 FROM resume_skill_claim_review_events e
  WHERE e.organization_id = rc.organization_id AND e.claim_id = rc.id
);
ALTER TABLE resume_skill_claim_review_events
  ALTER COLUMN review_version SET NOT NULL;
ALTER TABLE resume_skill_claim_review_events
  ADD CONSTRAINT resume_skill_claim_review_event_version_positive
  CHECK (review_version >= 1);
CREATE UNIQUE INDEX resume_skill_claim_review_revision_uq
  ON resume_skill_claim_review_events(organization_id, claim_id, review_version);
ALTER TABLE resume_skill_claim_review_events
  DROP CONSTRAINT IF EXISTS resume_skill_claim_review_events_new_state_check;
ALTER TABLE resume_skill_claim_review_events
  ADD CONSTRAINT resume_skill_claim_review_events_new_state_check
  CHECK (new_state IN ('confirmed', 'rejected', 'corrected'));
COMMENT ON COLUMN resume_skill_claims.review_version IS
  'Optimistic concurrency revision for human claim mapping review; never an interview score.';
COMMENT ON TABLE resume_skill_claim_review_events IS
  'Tenant-scoped ordered history of source-anchored resume assertions, including human mapping corrections. Original resume evidence remains unchanged.';
