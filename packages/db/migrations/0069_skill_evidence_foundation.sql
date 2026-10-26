-- Skill Evidence Graph: additive phase-1 foundation. Existing rubric/scorecard remains authoritative.
-- All referenced objects are scoped by organization_id; this migration never assigns interview scores.
CREATE TABLE skill_taxonomy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  skill_key varchar(160) NOT NULL,
  name_fa varchar(200),
  name_en varchar(200) NOT NULL,
  category varchar(80) NOT NULL DEFAULT 'technical',
  description text,
  parent_skill_id uuid,
  related_skill_keys text[] NOT NULL DEFAULT '{}',
  taxonomy_version varchar(40) NOT NULL DEFAULT 'v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, skill_key),
  FOREIGN KEY (organization_id, parent_skill_id)
    REFERENCES skill_taxonomy(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT skill_taxonomy_key_check CHECK (skill_key ~ '^[a-z0-9][a-z0-9-]{0,159}$')
);
CREATE INDEX skill_taxonomy_search_idx ON skill_taxonomy(organization_id, category, name_en);

CREATE TABLE skill_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  skill_id uuid NOT NULL,
  alias_normalized varchar(200) NOT NULL,
  origin varchar(32) NOT NULL DEFAULT 'human_reviewed'
    CHECK (origin IN ('human_reviewed', 'taxonomy_seed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, alias_normalized),
  FOREIGN KEY (organization_id, skill_id)
    REFERENCES skill_taxonomy(organization_id, id) ON DELETE CASCADE
);

-- Versioned job requirements are intentionally separate from the already published rubric.
-- A new skill requirement is not an automatic scoring criterion.
CREATE TABLE job_skill_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  job_id uuid NOT NULL,
  skill_id uuid NOT NULL,
  required_level smallint NOT NULL CHECK (required_level BETWEEN 1 AND 5),
  weight numeric(6,3) NOT NULL DEFAULT 1 CHECK (weight > 0),
  required boolean NOT NULL DEFAULT true,
  minimum_evidence_count smallint NOT NULL DEFAULT 1
    CHECK (minimum_evidence_count BETWEEN 1 AND 20),
  behavioral_anchors jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(behavioral_anchors) = 'object'),
  rubric_criterion_id uuid,
  requirement_version integer NOT NULL DEFAULT 1 CHECK (requirement_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, job_id, skill_id, requirement_version),
  FOREIGN KEY (organization_id, job_id)
    REFERENCES jobs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, skill_id)
    REFERENCES skill_taxonomy(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, rubric_criterion_id)
    REFERENCES rubric_criteria(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX job_skill_requirements_job_idx
  ON job_skill_requirements(organization_id, job_id, required, requirement_version DESC);

CREATE FUNCTION check_job_skill_criterion_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rubric_criterion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM rubric_criteria rc
    JOIN rubric_versions rv
      ON rv.organization_id = rc.organization_id AND rv.id = rc.rubric_version_id
    JOIN rubrics r
      ON r.organization_id = rv.organization_id AND r.id = rv.rubric_id
    WHERE rc.organization_id = NEW.organization_id
      AND rc.id = NEW.rubric_criterion_id
      AND r.job_id = NEW.job_id
  ) THEN
    RAISE EXCEPTION 'Skill requirement rubric criterion belongs to another job'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER job_skill_criterion_scope
  BEFORE INSERT OR UPDATE OF job_id, rubric_criterion_id ON job_skill_requirements
  FOR EACH ROW EXECUTE FUNCTION check_job_skill_criterion_scope();

-- Preserve tenant, candidate, resume and original evidence provenance in one constrained edge.
-- "extracted" means a resume assertion, not a verified competency.
CREATE UNIQUE INDEX resumes_org_candidate_id_uq
  ON resumes(organization_id, candidate_id, id);

CREATE TABLE resume_skill_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  resume_id uuid NOT NULL,
  skill_id uuid NOT NULL,
  evidence_id uuid,
  source_reference varchar(512) NOT NULL,
  claim_text text NOT NULL CHECK (char_length(btrim(claim_text)) > 0),
  start_char integer NOT NULL CHECK (start_char >= 0),
  end_char integer NOT NULL CHECK (end_char > start_char),
  extraction_confidence numeric(5,4) NOT NULL
    CHECK (extraction_confidence BETWEEN 0 AND 1),
  mapping_origin varchar(40) NOT NULL DEFAULT 'deterministic_v1'
    CHECK (mapping_origin IN ('deterministic_v1', 'llm_reviewed', 'human_reviewed')),
  taxonomy_version varchar(40) NOT NULL,
  parser_version varchar(80) NOT NULL,
  review_state varchar(32) NOT NULL DEFAULT 'pending'
    CHECK (review_state IN ('pending', 'confirmed', 'corrected', 'rejected')),
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, resume_id, skill_id),
  FOREIGN KEY (organization_id, candidate_id, resume_id)
    REFERENCES resumes(organization_id, candidate_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, skill_id)
    REFERENCES skill_taxonomy(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, evidence_id)
    REFERENCES evidence(organization_id, id) ON DELETE SET NULL (evidence_id),
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT claim_review_consistency CHECK (
    (review_state = 'pending' AND reviewed_at IS NULL AND reviewed_by_user_id IS NULL)
    OR (review_state <> 'pending' AND reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL)
  )
);
CREATE INDEX resume_skill_claims_candidate_idx
  ON resume_skill_claims(organization_id, candidate_id, created_at DESC);
CREATE INDEX resume_skill_claims_skill_idx
  ON resume_skill_claims(organization_id, skill_id, review_state);

CREATE FUNCTION check_resume_claim_evidence_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.evidence_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM evidence e
    WHERE e.organization_id = NEW.organization_id AND e.id = NEW.evidence_id
      AND e.candidate_id = NEW.candidate_id
      AND e.source_type = 'resume' AND e.evidence_type = 'resume_claim'
      AND e.source_reference = NEW.source_reference
  ) THEN
    RAISE EXCEPTION 'Resume skill claim evidence must match candidate and resume source'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER resume_skill_claim_evidence_scope
  BEFORE INSERT OR UPDATE OF evidence_id, candidate_id, source_reference ON resume_skill_claims
  FOR EACH ROW EXECUTE FUNCTION check_resume_claim_evidence_scope();

COMMENT ON TABLE resume_skill_claims IS
  'Source-anchored unverified resume assertions. Neither extraction confidence nor review state changes interview scores.';
COMMENT ON TABLE job_skill_requirements IS
  'Versioned skill objectives; current rubric versions and scorecard algorithm remain authoritative until explicitly mapped.';
