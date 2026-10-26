CREATE TABLE IF NOT EXISTS resume_skill_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  resume_id uuid NOT NULL,
  skill_id uuid NOT NULL,
  source_text_sha256 varchar(64) NOT NULL CHECK (source_text_sha256 ~ '^[0-9a-f]{64}$'),
  claim_text text NOT NULL CHECK (char_length(claim_text) BETWEEN 1 AND 400),
  start_char integer NOT NULL CHECK (start_char >= 0),
  end_char integer NOT NULL CHECK (end_char > start_char),
  extraction_confidence numeric(5,4) NOT NULL CHECK (extraction_confidence BETWEEN 0 AND 1),
  provider varchar(80) NOT NULL,
  model varchar(160) NOT NULL,
  prompt_version varchar(48) NOT NULL DEFAULT 'skill-proposals.v1',
  review_state varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (review_state IN ('pending', 'approved', 'rejected')),
  review_version integer NOT NULL DEFAULT 0 CHECK (review_version BETWEEN 0 AND 10000),
  review_reason text,
  reviewer_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, resume_id, skill_id, source_text_sha256, start_char, end_char),
  FOREIGN KEY (organization_id, candidate_id, resume_id)
    REFERENCES resumes(organization_id, candidate_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, skill_id)
    REFERENCES skill_taxonomy(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT skill_proposal_review_consistency CHECK (
    (review_state = 'pending' AND review_version = 0 AND reviewer_user_id IS NULL AND reviewed_at IS NULL)
    OR (review_state <> 'pending' AND review_version > 0 AND reviewer_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE INDEX resume_skill_proposals_candidate_idx
  ON resume_skill_proposals(organization_id, candidate_id, resume_id, created_at DESC);
CREATE TABLE IF NOT EXISTS resume_skill_proposal_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_state varchar(24) NOT NULL,
  new_state varchar(24) NOT NULL CHECK (new_state IN ('approved', 'rejected')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 8 AND 1000),
  alias_normalized varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, proposal_id),
  FOREIGN KEY (organization_id, proposal_id)
    REFERENCES resume_skill_proposals(organization_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE resume_skill_proposals IS
  'Opt-in LLM suggestions only. Anchored to immutable resume text SHA; never accepted as competency evidence or scored automatically.';
COMMENT ON TABLE resume_skill_proposal_review_events IS
  'Human audit of one-time LLM suggestion approval or rejection, and optional explicit taxonomy alias registration.';
