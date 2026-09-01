CREATE TABLE IF NOT EXISTS assessment_execution_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'claimed', 'succeeded', 'failed', 'cancelled')),
  requested_runner_type varchar(64) NOT NULL DEFAULT 'isolated-worker',
  time_limit_ms integer NOT NULL CHECK (time_limit_ms > 0),
  memory_limit_mb integer NOT NULL CHECK (memory_limit_mb > 0),
  network_access boolean NOT NULL DEFAULT false CHECK (network_access = false),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  external_job_reference varchar(512),
  last_error text,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, submission_id),
  FOREIGN KEY (organization_id, submission_id)
    REFERENCES assessment_submissions(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS assessment_execution_jobs_state_idx
  ON assessment_execution_jobs(organization_id, state, created_at);

CREATE TABLE IF NOT EXISTS assessment_grading_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assessment_session_id uuid NOT NULL,
  assessment_result_id uuid,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  review_state varchar(32) NOT NULL
    CHECK (review_state IN ('approved', 'needs_follow_up', 'overridden')),
  reviewer_score numeric(5,2) CHECK (reviewer_score IS NULL OR (reviewer_score >= 0 AND reviewer_score <= 100)),
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, assessment_session_id)
    REFERENCES assessment_sessions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, assessment_result_id)
    REFERENCES assessment_results(organization_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS assessment_grading_reviews_session_idx
  ON assessment_grading_reviews(organization_id, assessment_session_id, created_at DESC);

ALTER TABLE assessment_sessions
  ADD COLUMN IF NOT EXISTS review_state varchar(32) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
