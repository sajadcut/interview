CREATE TABLE IF NOT EXISTS application_stage_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  from_stage varchar(80) NOT NULL,
  to_stage varchar(80) NOT NULL,
  reason text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, application_id)
    REFERENCES applications(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS application_stage_transitions_application_idx
  ON application_stage_transitions(organization_id, application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS shortlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  name varchar(240) NOT NULL DEFAULT 'Primary shortlist',
  status varchar(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'finalized', 'archived')),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, job_id, name),
  FOREIGN KEY (organization_id, job_id) REFERENCES jobs(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shortlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shortlist_id uuid NOT NULL,
  application_id uuid NOT NULL,
  rank integer CHECK (rank IS NULL OR rank > 0),
  rationale text,
  added_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (shortlist_id, application_id),
  FOREIGN KEY (organization_id, shortlist_id)
    REFERENCES shortlists(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, application_id)
    REFERENCES applications(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS shortlist_entries_shortlist_idx
  ON shortlist_entries(organization_id, shortlist_id, rank NULLS LAST, created_at);

CREATE TABLE IF NOT EXISTS hiring_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  decision varchar(32) NOT NULL
    CHECK (decision IN ('advance', 'hold', 'reject', 'hire', 'withdraw')),
  reason text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  scorecard_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, application_id)
    REFERENCES applications(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, scorecard_id)
    REFERENCES scorecards(organization_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS hiring_decisions_application_idx
  ON hiring_decisions(organization_id, application_id, created_at DESC);
