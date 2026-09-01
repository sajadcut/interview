CREATE TABLE IF NOT EXISTS candidate_duplicate_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  canonical_candidate_id uuid NOT NULL,
  duplicate_candidate_id uuid NOT NULL,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  state varchar(32) NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'accepted', 'rejected')),
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, canonical_candidate_id, duplicate_candidate_id),
  CHECK (canonical_candidate_id <> duplicate_candidate_id),
  FOREIGN KEY (organization_id, canonical_candidate_id)
    REFERENCES candidates(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, duplicate_candidate_id)
    REFERENCES candidates(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS candidate_duplicate_reviews_state_idx
  ON candidate_duplicate_reviews(organization_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS candidate_aliases (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  duplicate_candidate_id uuid NOT NULL,
  canonical_candidate_id uuid NOT NULL,
  review_id uuid NOT NULL REFERENCES candidate_duplicate_reviews(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, duplicate_candidate_id),
  CHECK (canonical_candidate_id <> duplicate_candidate_id),
  FOREIGN KEY (organization_id, canonical_candidate_id)
    REFERENCES candidates(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, duplicate_candidate_id)
    REFERENCES candidates(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS candidate_match_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  application_id uuid,
  score numeric(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  algorithm_version varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, job_id) REFERENCES jobs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidates(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, application_id) REFERENCES applications(organization_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS candidate_match_snapshots_lookup_idx
  ON candidate_match_snapshots(organization_id, job_id, candidate_id, created_at DESC);

ALTER TABLE screening_sessions
  ADD COLUMN IF NOT EXISTS reviewer_reason text;

ALTER TABLE scheduling_requests
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS delivery_status varchar(32) NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS delivery_error text;

CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES recruitment_notifications(id) ON DELETE CASCADE,
  provider varchar(64) NOT NULL,
  state varchar(32) NOT NULL CHECK (state IN ('attempted', 'sent', 'failed')),
  provider_reference varchar(512),
  error_message text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS notification_delivery_attempts_notification_idx
  ON notification_delivery_attempts(organization_id, notification_id, attempted_at DESC);
