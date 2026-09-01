ALTER TABLE interview_plans
  ADD COLUMN IF NOT EXISTS generated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS generation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS evaluator_calibration_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rubric_version_id uuid NOT NULL,
  name varchar(240) NOT NULL,
  transcript_fixture jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_criterion_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_recommendation varchar(48),
  tolerance numeric(6,3) NOT NULL DEFAULT 10 CHECK (tolerance >= 0 AND tolerance <= 100),
  active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, rubric_version_id)
    REFERENCES rubric_versions(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS evaluator_calibration_cases_rubric_idx
  ON evaluator_calibration_cases(organization_id, rubric_version_id, active, created_at DESC);

CREATE TABLE IF NOT EXISTS evaluator_calibration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  calibration_case_id uuid NOT NULL,
  evaluator_version varchar(120) NOT NULL,
  criterion_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendation varchar(48),
  mean_absolute_score_delta numeric(8,4),
  recommendation_agreement boolean NOT NULL DEFAULT false,
  within_tolerance boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, calibration_case_id)
    REFERENCES evaluator_calibration_cases(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS evaluator_calibration_runs_version_idx
  ON evaluator_calibration_runs(organization_id, evaluator_version, created_at DESC);
