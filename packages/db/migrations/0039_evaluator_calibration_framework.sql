CREATE TABLE IF NOT EXISTS evaluator_calibration_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dataset_key varchar(120) NOT NULL,
  version varchar(80) NOT NULL,
  name varchar(240) NOT NULL,
  description text,
  status varchar(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'locked', 'retired')),
  thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  threshold_policy_version varchar(120) NOT NULL DEFAULT 'calibration-gate-v1',
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  locked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, dataset_key, version)
);
CREATE INDEX IF NOT EXISTS evaluator_calibration_datasets_status_idx
  ON evaluator_calibration_datasets(organization_id, status, created_at DESC);

ALTER TABLE evaluator_calibration_cases
  ADD COLUMN IF NOT EXISTS dataset_id uuid,
  ADD COLUMN IF NOT EXISTS case_key varchar(160),
  ADD COLUMN IF NOT EXISTS interview_type varchar(80),
  ADD COLUMN IF NOT EXISTS expected_overall_score numeric(5,2)
    CHECK (expected_overall_score IS NULL OR (expected_overall_score >= 0 AND expected_overall_score <= 100)),
  ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reference_review_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evaluator_calibration_cases_dataset_fk'
  ) THEN
    ALTER TABLE evaluator_calibration_cases
      ADD CONSTRAINT evaluator_calibration_cases_dataset_fk
      FOREIGN KEY (organization_id, dataset_id)
      REFERENCES evaluator_calibration_datasets(organization_id, id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS evaluator_calibration_cases_dataset_case_key_uq
  ON evaluator_calibration_cases(organization_id, dataset_id, case_key)
  WHERE dataset_id IS NOT NULL AND case_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS evaluator_calibration_cases_dataset_idx
  ON evaluator_calibration_cases(organization_id, dataset_id, active, created_at DESC)
  WHERE dataset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS evaluator_calibration_cases_slice_idx
  ON evaluator_calibration_cases(organization_id, language, job_family, interview_type)
  WHERE dataset_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS evaluator_calibration_human_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  calibration_case_id uuid NOT NULL,
  review_version integer NOT NULL CHECK (review_version > 0),
  reviewer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewer_reference varchar(240),
  status varchar(24) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'adjudicated')),
  criterion_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendation varchar(48),
  overall_score numeric(5,2)
    CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100)),
  confidence numeric(5,4)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  evidence_references jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  is_reference boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (calibration_case_id, review_version),
  FOREIGN KEY (organization_id, calibration_case_id)
    REFERENCES evaluator_calibration_cases(organization_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS evaluator_calibration_human_reviews_reference_uq
  ON evaluator_calibration_human_reviews(organization_id, calibration_case_id)
  WHERE is_reference = true;
CREATE INDEX IF NOT EXISTS evaluator_calibration_human_reviews_case_idx
  ON evaluator_calibration_human_reviews(organization_id, calibration_case_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evaluator_calibration_cases_reference_review_fk'
  ) THEN
    ALTER TABLE evaluator_calibration_cases
      ADD CONSTRAINT evaluator_calibration_cases_reference_review_fk
      FOREIGN KEY (organization_id, reference_review_id)
      REFERENCES evaluator_calibration_human_reviews(organization_id, id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE evaluator_calibration_runs
  ALTER COLUMN recommendation_agreement DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS reference_review_id uuid,
  ADD COLUMN IF NOT EXISTS ai_evaluation_id uuid,
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(200),
  ADD COLUMN IF NOT EXISTS input_fingerprint varchar(64),
  ADD COLUMN IF NOT EXISTS provider varchar(80),
  ADD COLUMN IF NOT EXISTS model varchar(160),
  ADD COLUMN IF NOT EXISTS prompt_version varchar(120),
  ADD COLUMN IF NOT EXISTS criterion_comparisons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reference_criterion_count integer
    CHECK (reference_criterion_count IS NULL OR reference_criterion_count >= 0),
  ADD COLUMN IF NOT EXISTS matched_criterion_count integer
    CHECK (matched_criterion_count IS NULL OR matched_criterion_count >= 0),
  ADD COLUMN IF NOT EXISTS coverage_rate numeric(7,6)
    CHECK (coverage_rate IS NULL OR (coverage_rate >= 0 AND coverage_rate <= 1)),
  ADD COLUMN IF NOT EXISTS root_mean_squared_score_delta numeric(8,4),
  ADD COLUMN IF NOT EXISTS max_absolute_score_delta numeric(8,4),
  ADD COLUMN IF NOT EXISTS mean_signed_score_delta numeric(8,4),
  ADD COLUMN IF NOT EXISTS within_tolerance_rate numeric(7,6)
    CHECK (within_tolerance_rate IS NULL OR (within_tolerance_rate >= 0 AND within_tolerance_rate <= 1)),
  ADD COLUMN IF NOT EXISTS evidence_agreement_rate numeric(7,6)
    CHECK (evidence_agreement_rate IS NULL OR (evidence_agreement_rate >= 0 AND evidence_agreement_rate <= 1)),
  ADD COLUMN IF NOT EXISTS low_confidence_rate numeric(7,6)
    CHECK (low_confidence_rate IS NULL OR (low_confidence_rate >= 0 AND low_confidence_rate <= 1)),
  ADD COLUMN IF NOT EXISTS false_reject boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS false_promotion boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS case_pass boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evaluator_calibration_runs_reference_review_fk'
  ) THEN
    ALTER TABLE evaluator_calibration_runs
      ADD CONSTRAINT evaluator_calibration_runs_reference_review_fk
      FOREIGN KEY (organization_id, reference_review_id)
      REFERENCES evaluator_calibration_human_reviews(organization_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evaluator_calibration_runs_ai_evaluation_fk'
  ) THEN
    ALTER TABLE evaluator_calibration_runs
      ADD CONSTRAINT evaluator_calibration_runs_ai_evaluation_fk
      FOREIGN KEY (organization_id, ai_evaluation_id)
      REFERENCES interview_evaluations(organization_id, id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS evaluator_calibration_runs_case_idempotency_uq
  ON evaluator_calibration_runs(organization_id, calibration_case_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS evaluator_calibration_runs_reference_idx
  ON evaluator_calibration_runs(organization_id, reference_review_id, created_at DESC)
  WHERE reference_review_id IS NOT NULL;
