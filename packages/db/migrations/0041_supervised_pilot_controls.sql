CREATE TABLE IF NOT EXISTS supervised_pilot_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  release_unit_id uuid NOT NULL,
  name varchar(240) NOT NULL,
  description text,
  status varchar(32) NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'pending_approval', 'approved', 'active', 'paused', 'completed', 'revoked')
  ),
  feature_enabled boolean NOT NULL DEFAULT false,
  max_total_interviews integer NOT NULL CHECK (max_total_interviews > 0),
  max_concurrent_interviews integer NOT NULL CHECK (max_concurrent_interviews > 0),
  max_interviews_per_candidate integer NOT NULL DEFAULT 1 CHECK (max_interviews_per_candidate > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  default_review_owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  incident_owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  support_contact varchar(320) NOT NULL,
  human_review_required boolean NOT NULL DEFAULT true CHECK (human_review_required = true),
  ai_final_decision_prohibited boolean NOT NULL DEFAULT true CHECK (ai_final_decision_prohibited = true),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  activated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  activated_at timestamptz,
  paused_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  paused_at timestamptz,
  revoked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  completed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, release_unit_id, name),
  CHECK (ends_at > starts_at),
  CHECK (max_concurrent_interviews <= max_total_interviews),
  FOREIGN KEY (organization_id, release_unit_id)
    REFERENCES interview_release_units(organization_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS supervised_pilot_programs_active_release_uq
  ON supervised_pilot_programs(organization_id, release_unit_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS supervised_pilot_programs_release_idx
  ON supervised_pilot_programs(organization_id, release_unit_id, status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS supervised_pilot_approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  program_id uuid NOT NULL,
  step_kind varchar(48) NOT NULL CHECK (
    step_kind IN ('customer_acknowledgement', 'pilot_owner', 'security_baseline', 'go_live')
  ),
  status varchar(24) NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'revoked')
  ),
  requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  rationale text,
  evidence_reference varchar(1024),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, program_id, step_kind),
  FOREIGN KEY (organization_id, program_id)
    REFERENCES supervised_pilot_programs(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS supervised_pilot_approval_steps_program_idx
  ON supervised_pilot_approval_steps(organization_id, program_id, status, step_kind);

CREATE TABLE IF NOT EXISTS supervised_pilot_approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  program_id uuid NOT NULL,
  approval_step_id uuid NOT NULL,
  event_type varchar(24) NOT NULL CHECK (
    event_type IN ('requested', 'approved', 'rejected', 'revoked')
  ),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rationale text,
  evidence_reference varchar(1024),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, program_id)
    REFERENCES supervised_pilot_programs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, approval_step_id)
    REFERENCES supervised_pilot_approval_steps(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS supervised_pilot_approval_events_program_idx
  ON supervised_pilot_approval_events(organization_id, program_id, created_at DESC);

CREATE TABLE IF NOT EXISTS supervised_pilot_admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  program_id uuid NOT NULL,
  interview_session_id uuid NOT NULL,
  application_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  review_owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(24) NOT NULL DEFAULT 'admitted' CHECK (
    status IN ('admitted', 'completed', 'cancelled')
  ),
  admitted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, interview_session_id),
  FOREIGN KEY (organization_id, program_id)
    REFERENCES supervised_pilot_programs(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, interview_session_id)
    REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, application_id)
    REFERENCES applications(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, candidate_id)
    REFERENCES candidates(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS supervised_pilot_admissions_program_status_idx
  ON supervised_pilot_admissions(organization_id, program_id, status, admitted_at);
CREATE INDEX IF NOT EXISTS supervised_pilot_admissions_application_idx
  ON supervised_pilot_admissions(organization_id, application_id, admitted_at DESC);
CREATE INDEX IF NOT EXISTS supervised_pilot_admissions_candidate_idx
  ON supervised_pilot_admissions(organization_id, program_id, candidate_id, admitted_at DESC);

CREATE TABLE IF NOT EXISTS supervised_pilot_human_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL,
  interview_session_id uuid NOT NULL,
  review_owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewer_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  recommendation varchar(40) CHECK (
    recommendation IN ('advance', 'hold', 'reject', 'hire', 'insufficient_evidence')
  ),
  notes text,
  reviewed_at timestamptz,
  source varchar(24) NOT NULL DEFAULT 'human' CHECK (source = 'human'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, admission_id),
  UNIQUE (organization_id, interview_session_id),
  CHECK (
    (status = 'pending' AND reviewer_user_id IS NULL AND recommendation IS NULL AND reviewed_at IS NULL)
    OR
    (status = 'completed' AND reviewer_user_id IS NOT NULL AND recommendation IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  FOREIGN KEY (organization_id, admission_id)
    REFERENCES supervised_pilot_admissions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, interview_session_id)
    REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS supervised_pilot_human_reviews_owner_idx
  ON supervised_pilot_human_reviews(organization_id, review_owner_user_id, status, created_at);
