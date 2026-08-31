INSERT INTO permissions (key, description) VALUES
  ('sourcing.run', 'Run approved candidate sourcing searches'),
  ('talent.manage', 'Manage organization talent-pool membership')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS talent_pool_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  tags text[] NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, candidate_id),
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidates(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS talent_pool_org_status_idx ON talent_pool_entries(organization_id, status);

CREATE TABLE IF NOT EXISTS sourcing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  strategy jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  result_count integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, job_id) REFERENCES jobs(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sourcing_runs_job_idx ON sourcing_runs(organization_id, job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS discovered_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sourcing_run_id uuid NOT NULL,
  candidate_id uuid,
  source_type varchar(64) NOT NULL,
  source_external_key varchar(512),
  normalized_identity jsonb NOT NULL DEFAULT '{}'::jsonb,
  profile_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  retrieval_score numeric(8,6),
  pre_interview_match_score numeric(5,2),
  dedupe_state varchar(32) NOT NULL DEFAULT 'unresolved',
  review_state varchar(32) NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, sourcing_run_id) REFERENCES sourcing_runs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidates(organization_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS discovered_candidates_run_idx ON discovered_candidates(organization_id, sourcing_run_id, retrieval_score DESC);
CREATE INDEX IF NOT EXISTS discovered_candidates_candidate_idx ON discovered_candidates(organization_id, candidate_id);

CREATE TABLE IF NOT EXISTS sourcing_merge_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  discovered_candidate_id uuid NOT NULL REFERENCES discovered_candidates(id) ON DELETE CASCADE,
  proposed_candidate_id uuid NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'pending',
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, proposed_candidate_id) REFERENCES candidates(organization_id, id) ON DELETE CASCADE
);
