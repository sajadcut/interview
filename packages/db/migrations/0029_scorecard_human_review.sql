CREATE TABLE IF NOT EXISTS scorecard_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scorecard_id uuid NOT NULL,
  application_id uuid NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  review_state varchar(32) NOT NULL
    CHECK (review_state IN ('approved', 'overridden', 'needs_more_evidence')),
  human_recommendation varchar(64),
  human_overall_score numeric(5,2)
    CHECK (human_overall_score IS NULL OR (human_overall_score >= 0 AND human_overall_score <= 100)),
  reason text NOT NULL,
  ai_human_disagreement boolean NOT NULL DEFAULT false,
  algorithm_recommendation varchar(64),
  algorithm_overall_score numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, scorecard_id)
    REFERENCES scorecards(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, application_id)
    REFERENCES applications(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS scorecard_reviews_scorecard_idx
  ON scorecard_reviews(organization_id, scorecard_id, created_at DESC);

ALTER TABLE scorecards
  ADD COLUMN IF NOT EXISTS latest_human_review_id uuid,
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
