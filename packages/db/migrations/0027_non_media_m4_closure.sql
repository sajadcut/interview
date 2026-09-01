CREATE TABLE IF NOT EXISTS interview_key_moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_session_id uuid NOT NULL,
  moment_type varchar(48) NOT NULL
    CHECK (moment_type IN ('evidence', 'concern', 'clarification', 'contradiction', 'decision_context')),
  criterion_id uuid,
  transcript_segment_id uuid,
  summary text NOT NULL,
  created_by_type varchar(24) NOT NULL CHECK (created_by_type IN ('system', 'evaluator', 'human')),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, interview_session_id)
    REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, criterion_id)
    REFERENCES rubric_criteria(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, transcript_segment_id)
    REFERENCES interview_transcript_segments(organization_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS interview_key_moments_session_idx
  ON interview_key_moments(organization_id, interview_session_id, created_at);

CREATE TABLE IF NOT EXISTS evaluator_calibration_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  release_unit_id uuid NOT NULL,
  criterion_id uuid NOT NULL,
  language varchar(24) NOT NULL,
  job_family varchar(160) NOT NULL,
  human_score numeric(5,2) NOT NULL CHECK (human_score >= 0 AND human_score <= 100),
  ai_score numeric(5,2) NOT NULL CHECK (ai_score >= 0 AND ai_score <= 100),
  human_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric(5,4),
  adjudicated_score numeric(5,2) CHECK (adjudicated_score IS NULL OR (adjudicated_score >= 0 AND adjudicated_score <= 100)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, release_unit_id)
    REFERENCES interview_release_units(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, criterion_id)
    REFERENCES rubric_criteria(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS evaluator_calibration_release_idx
  ON evaluator_calibration_cases(organization_id, release_unit_id, criterion_id);

CREATE TABLE IF NOT EXISTS interview_simulation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_plan_id uuid NOT NULL,
  scenario_key varchar(120) NOT NULL,
  brain_version varchar(120) NOT NULL,
  input_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  violations jsonb NOT NULL DEFAULT '[]'::jsonb,
  passed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, interview_plan_id)
    REFERENCES interview_plans(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS interview_simulation_plan_idx
  ON interview_simulation_runs(organization_id, interview_plan_id, created_at DESC);

CREATE TABLE IF NOT EXISTS interview_release_gate_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  release_unit_id uuid NOT NULL,
  gate_key varchar(8) NOT NULL CHECK (gate_key IN ('A', 'B', 'G', 'H', 'I', 'J', 'K')),
  status varchar(24) NOT NULL CHECK (status IN ('not_ready', 'ready_for_validation', 'passed', 'failed')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, release_unit_id, gate_key),
  FOREIGN KEY (organization_id, release_unit_id)
    REFERENCES interview_release_units(organization_id, id) ON DELETE CASCADE
);

ALTER TABLE interview_evaluations
  ADD COLUMN IF NOT EXISTS evidence_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS calibration_reference varchar(512);
