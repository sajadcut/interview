CREATE TABLE IF NOT EXISTS evaluator_shadow_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  release_unit_id uuid NOT NULL,
  name varchar(240) NOT NULL,
  description text,
  status varchar(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'completed')),
  evaluator_version varchar(120) NOT NULL,
  policy_version varchar(120) NOT NULL DEFAULT 'shadow-evaluation-v1',
  target_sample_size integer NOT NULL DEFAULT 50 CHECK (target_sample_size > 0),
  thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_visibility_policy varchar(64) NOT NULL DEFAULT 'sealed_until_human_outcome'
    CHECK (result_visibility_policy = 'sealed_until_human_outcome'),
  decision_influence_prohibited boolean NOT NULL DEFAULT true
    CHECK (decision_influence_prohibited = true),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  activated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  activated_at timestamptz,
  completed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, release_unit_id, name),
  FOREIGN KEY (organization_id, release_unit_id)
    REFERENCES interview_release_units(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS evaluator_shadow_programs_status_idx
  ON evaluator_shadow_programs(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS evaluator_shadow_programs_release_unit_idx
  ON evaluator_shadow_programs(organization_id, release_unit_id, status);

CREATE TABLE IF NOT EXISTS evaluator_shadow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shadow_program_id uuid NOT NULL,
  interview_session_id uuid NOT NULL,
  application_id uuid NOT NULL,
  rubric_version_id uuid NOT NULL,
  evaluator_version varchar(120) NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  input_fingerprint varchar(64) NOT NULL,
  draft_fingerprint varchar(64) NOT NULL,
  provider varchar(80) NOT NULL,
  model varchar(160),
  prompt_version varchar(120) NOT NULL,
  evaluator_trace_reference varchar(512),
  ai_status varchar(32) NOT NULL
    CHECK (ai_status IN ('validated', 'low_confidence', 'insufficient_evidence')),
  ai_criterion_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_recommendation varchar(48) NOT NULL,
  ai_overall_score numeric(5,2)
    CHECK (ai_overall_score IS NULL OR (ai_overall_score >= 0 AND ai_overall_score <= 100)),
  ai_overall_confidence numeric(5,4) NOT NULL
    CHECK (ai_overall_confidence >= 0 AND ai_overall_confidence <= 1),
  evidence_complete boolean NOT NULL,
  validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_visibility_policy varchar(64) NOT NULL DEFAULT 'sealed_until_human_outcome'
    CHECK (result_visibility_policy = 'sealed_until_human_outcome'),
  decision_influence_prohibited boolean NOT NULL DEFAULT true
    CHECK (decision_influence_prohibited = true),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, shadow_program_id, interview_session_id, idempotency_key),
  FOREIGN KEY (organization_id, shadow_program_id)
    REFERENCES evaluator_shadow_programs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, interview_session_id)
    REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, application_id)
    REFERENCES applications(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, rubric_version_id)
    REFERENCES rubric_versions(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS evaluator_shadow_runs_program_idx
  ON evaluator_shadow_runs(organization_id, shadow_program_id, created_at DESC);
CREATE INDEX IF NOT EXISTS evaluator_shadow_runs_session_idx
  ON evaluator_shadow_runs(organization_id, interview_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS evaluator_shadow_runs_application_idx
  ON evaluator_shadow_runs(organization_id, application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evaluator_shadow_human_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shadow_run_id uuid NOT NULL,
  reviewer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source_type varchar(48) NOT NULL
    CHECK (source_type IN ('scorecard_review', 'manual_blind_reference', 'final_application_snapshot')),
  source_reference varchar(512),
  recommendation varchar(48) NOT NULL,
  overall_score numeric(5,2)
    CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100)),
  criterion_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  application_status varchar(40),
  pipeline_stage varchar(80),
  decision_recorded_at timestamptz NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, shadow_run_id),
  FOREIGN KEY (organization_id, shadow_run_id)
    REFERENCES evaluator_shadow_runs(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS evaluator_shadow_human_outcomes_run_idx
  ON evaluator_shadow_human_outcomes(organization_id, shadow_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evaluator_shadow_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shadow_run_id uuid NOT NULL,
  human_outcome_id uuid NOT NULL,
  policy_version varchar(120) NOT NULL,
  criterion_comparisons jsonb NOT NULL DEFAULT '[]'::jsonb,
  reference_criterion_count integer NOT NULL CHECK (reference_criterion_count >= 0),
  matched_criterion_count integer NOT NULL CHECK (matched_criterion_count >= 0),
  coverage_rate numeric(7,6) NOT NULL CHECK (coverage_rate >= 0 AND coverage_rate <= 1),
  mean_absolute_score_delta numeric(8,4),
  root_mean_squared_score_delta numeric(8,4),
  max_absolute_score_delta numeric(8,4),
  mean_signed_score_delta numeric(8,4),
  recommendation_agreement boolean NOT NULL,
  overall_score_delta numeric(8,4),
  false_reject boolean NOT NULL DEFAULT false,
  false_promotion boolean NOT NULL DEFAULT false,
  low_confidence boolean NOT NULL DEFAULT false,
  requires_root_cause_review boolean NOT NULL DEFAULT false,
  root_cause_review_state varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (root_cause_review_state IN ('pending', 'completed', 'not_required')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, shadow_run_id),
  FOREIGN KEY (organization_id, shadow_run_id)
    REFERENCES evaluator_shadow_runs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, human_outcome_id)
    REFERENCES evaluator_shadow_human_outcomes(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS evaluator_shadow_comparisons_program_analysis_idx
  ON evaluator_shadow_comparisons(organization_id, requires_root_cause_review, created_at DESC);

CREATE TABLE IF NOT EXISTS evaluator_shadow_root_cause_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shadow_comparison_id uuid NOT NULL,
  reviewer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  severity varchar(24) NOT NULL DEFAULT 'moderate'
    CHECK (severity IN ('low', 'moderate', 'high', 'critical')),
  notes text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, shadow_comparison_id)
    REFERENCES evaluator_shadow_comparisons(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS evaluator_shadow_root_cause_reviews_comparison_idx
  ON evaluator_shadow_root_cause_reviews(organization_id, shadow_comparison_id, created_at DESC);
