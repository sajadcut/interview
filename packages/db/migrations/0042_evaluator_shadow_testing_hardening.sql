ALTER TABLE evaluator_shadow_runs
  ADD COLUMN input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN session_completed_at timestamptz,
  ADD COLUMN execution_status varchar(24) NOT NULL DEFAULT 'succeeded',
  ADD COLUMN failure_category varchar(48),
  ADD COLUMN failure_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN evaluator_latency_ms integer,
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0;

ALTER TABLE evaluator_shadow_runs
  ALTER COLUMN ai_status DROP NOT NULL,
  ALTER COLUMN ai_recommendation DROP NOT NULL,
  ALTER COLUMN ai_overall_confidence DROP NOT NULL,
  ALTER COLUMN evidence_complete DROP NOT NULL;

ALTER TABLE evaluator_shadow_runs
  ADD CONSTRAINT evaluator_shadow_runs_execution_status_check
    CHECK (execution_status IN ('succeeded', 'failed')),
  ADD CONSTRAINT evaluator_shadow_runs_failure_category_check
    CHECK (
      failure_category IS NULL OR failure_category IN (
        'timeout', 'provider_error', 'invalid_output', 'cancelled', 'internal_error'
      )
    ),
  ADD CONSTRAINT evaluator_shadow_runs_latency_check
    CHECK (evaluator_latency_ms IS NULL OR evaluator_latency_ms >= 0),
  ADD CONSTRAINT evaluator_shadow_runs_retry_count_check
    CHECK (retry_count >= 0),
  ADD CONSTRAINT evaluator_shadow_runs_execution_shape_check
    CHECK (
      (
        execution_status = 'succeeded'
        AND failure_category IS NULL
        AND ai_status IS NOT NULL
        AND ai_recommendation IS NOT NULL
        AND ai_overall_confidence IS NOT NULL
        AND evidence_complete IS NOT NULL
      )
      OR
      (
        execution_status = 'failed'
        AND failure_category IS NOT NULL
        AND ai_status IS NULL
        AND ai_recommendation IS NULL
        AND ai_overall_confidence IS NULL
        AND evidence_complete IS NULL
      )
    );

CREATE UNIQUE INDEX evaluator_shadow_runs_program_session_uq
  ON evaluator_shadow_runs(organization_id, shadow_program_id, interview_session_id);

CREATE INDEX evaluator_shadow_runs_execution_status_idx
  ON evaluator_shadow_runs(organization_id, shadow_program_id, execution_status, created_at DESC);

ALTER TABLE evaluator_shadow_human_outcomes
  ADD COLUMN recorded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN blind_review_confirmed boolean,
  ADD COLUMN reviewer_independent boolean,
  ADD COLUMN outcome_fingerprint varchar(64);

UPDATE evaluator_shadow_human_outcomes h
SET recorded_by_user_id = COALESCE(h.recorded_by_user_id, h.reviewer_user_id),
    blind_review_confirmed = COALESCE(h.blind_review_confirmed, true),
    reviewer_independent = COALESCE(
      h.reviewer_independent,
      h.reviewer_user_id IS DISTINCT FROM r.created_by_user_id
    )
FROM evaluator_shadow_runs r
WHERE r.organization_id = h.organization_id
  AND r.id = h.shadow_run_id;

ALTER TABLE evaluator_shadow_human_outcomes
  ADD CONSTRAINT evaluator_shadow_human_outcomes_blind_check
    CHECK (blind_review_confirmed IS NULL OR blind_review_confirmed = true),
  ADD CONSTRAINT evaluator_shadow_human_outcomes_independent_check
    CHECK (reviewer_independent IS NULL OR reviewer_independent = true),
  ADD CONSTRAINT evaluator_shadow_human_outcomes_fingerprint_check
    CHECK (outcome_fingerprint IS NULL OR length(outcome_fingerprint) = 64);

ALTER TABLE evaluator_shadow_comparisons
  ADD COLUMN mean_evidence_agreement_rate numeric(7,6)
    CHECK (mean_evidence_agreement_rate IS NULL OR (mean_evidence_agreement_rate >= 0 AND mean_evidence_agreement_rate <= 1)),
  ADD COLUMN evidence_agreement_coverage_rate numeric(7,6)
    CHECK (evidence_agreement_coverage_rate IS NULL OR (evidence_agreement_coverage_rate >= 0 AND evidence_agreement_coverage_rate <= 1)),
  ADD COLUMN comparison_fingerprint varchar(64),
  ADD CONSTRAINT evaluator_shadow_comparisons_fingerprint_check
    CHECK (comparison_fingerprint IS NULL OR length(comparison_fingerprint) = 64);
