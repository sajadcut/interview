CREATE UNIQUE INDEX IF NOT EXISTS discovered_candidates_org_id_uq
  ON discovered_candidates(organization_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS interview_turns_org_id_uq
  ON interview_turns(organization_id, id);

ALTER TABLE sourcing_merge_reviews
  ADD CONSTRAINT sourcing_merge_reviews_org_discovered_fk
  FOREIGN KEY (organization_id, discovered_candidate_id)
  REFERENCES discovered_candidates(organization_id, id)
  ON DELETE CASCADE;

ALTER TABLE interview_evidence
  ADD CONSTRAINT interview_evidence_org_turn_fk
  FOREIGN KEY (organization_id, turn_id)
  REFERENCES interview_turns(organization_id, id)
  ON DELETE SET NULL;
