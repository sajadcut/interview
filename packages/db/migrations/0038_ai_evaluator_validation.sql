ALTER TABLE interview_evaluations
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(200),
  ADD COLUMN IF NOT EXISTS input_fingerprint varchar(64),
  ADD COLUMN IF NOT EXISTS provider varchar(80),
  ADD COLUMN IF NOT EXISTS model varchar(160),
  ADD COLUMN IF NOT EXISTS prompt_version varchar(120),
  ADD COLUMN IF NOT EXISTS input_references jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS overall_confidence numeric(5,4)
    CHECK (overall_confidence IS NULL OR (overall_confidence >= 0 AND overall_confidence <= 1)),
  ADD COLUMN IF NOT EXISTS weighted_score numeric(5,2)
    CHECK (weighted_score IS NULL OR (weighted_score >= 0 AND weighted_score <= 100)),
  ADD COLUMN IF NOT EXISTS score_algorithm_version varchar(80),
  ADD COLUMN IF NOT EXISTS validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS output_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS requires_human_review boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS scorecard_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS interview_evaluations_session_idempotency_uq
  ON interview_evaluations(organization_id, interview_session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS interview_evaluations_session_created_idx
  ON interview_evaluations(organization_id, interview_session_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interview_evaluations_scorecard_fk'
  ) THEN
    ALTER TABLE interview_evaluations
      ADD CONSTRAINT interview_evaluations_scorecard_fk
      FOREIGN KEY (organization_id, scorecard_id)
      REFERENCES scorecards(organization_id, id) ON DELETE SET NULL;
  END IF;
END $$;
