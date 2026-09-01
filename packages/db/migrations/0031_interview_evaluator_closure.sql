ALTER TABLE interview_plans
  ADD COLUMN IF NOT EXISTS generated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS generation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- evaluator_calibration_cases was introduced in 0027 for observed human-vs-AI
-- criterion pairs. 0031 extends the same table so it can also hold reusable,
-- provider-independent benchmark fixtures without destroying the earlier shape.
ALTER TABLE evaluator_calibration_cases
  ALTER COLUMN release_unit_id DROP NOT NULL,
  ALTER COLUMN criterion_id DROP NOT NULL,
  ALTER COLUMN language DROP NOT NULL,
  ALTER COLUMN job_family DROP NOT NULL,
  ALTER COLUMN human_score DROP NOT NULL,
  ALTER COLUMN ai_score DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS rubric_version_id uuid,
  ADD COLUMN IF NOT EXISTS name varchar(240),
  ADD COLUMN IF NOT EXISTS transcript_fixture jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS expected_criterion_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS expected_recommendation varchar(48),
  ADD COLUMN IF NOT EXISTS tolerance numeric(6,3) NOT NULL DEFAULT 10
    CHECK (tolerance >= 0 AND tolerance <= 100),
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evaluator_calibration_cases_rubric_version_fk'
  ) THEN
    ALTER TABLE evaluator_calibration_cases
      ADD CONSTRAINT evaluator_calibration_cases_rubric_version_fk
      FOREIGN KEY (organization_id, rubric_version_id)
      REFERENCES rubric_versions(organization_id, id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS evaluator_calibration_cases_rubric_idx
  ON evaluator_calibration_cases(organization_id, rubric_version_id, active, created_at DESC)
  WHERE rubric_version_id IS NOT NULL;

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
