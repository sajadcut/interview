INSERT INTO permissions (key, description) VALUES
  ('interview.evaluate', 'Evaluate persisted interview evidence against a rubric'),
  ('privacy.manage', 'Manage consent, retention and recording policies')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

CREATE UNIQUE INDEX IF NOT EXISTS files_org_id_uq ON files(organization_id, id);

CREATE TABLE IF NOT EXISTS consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  application_id uuid,
  purpose varchar(80) NOT NULL,
  policy_version varchar(80) NOT NULL,
  recording_allowed boolean NOT NULL DEFAULT false,
  transcript_allowed boolean NOT NULL DEFAULT true,
  granted_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidates(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, application_id) REFERENCES applications(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS consent_candidate_idx ON consent_records(organization_id, candidate_id, granted_at DESC);

CREATE TABLE IF NOT EXISTS interview_release_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_family varchar(160) NOT NULL,
  language varchar(24) NOT NULL,
  interview_type varchar(80) NOT NULL,
  rubric_version_family varchar(160) NOT NULL,
  interviewer_policy_version varchar(80) NOT NULL,
  speech_avatar_stack_version varchar(120) NOT NULL,
  evaluator_version varchar(120) NOT NULL,
  lifecycle_stage varchar(40) NOT NULL DEFAULT 'DEV_ONLY' CHECK (
    lifecycle_stage IN (
      'DEV_ONLY', 'INTERNAL_TEST', 'SHADOW', 'SUPERVISED_PILOT',
      'CONTROLLED_PRODUCTION', 'SCALED_PRODUCTION', 'SUSPENDED'
    )
  ),
  production_approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  production_approved_at timestamptz,
  approval_reference varchar(512),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (
    organization_id, job_family, language, interview_type, rubric_version_family,
    interviewer_policy_version, speech_avatar_stack_version, evaluator_version
  ),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS interview_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  rubric_version_id uuid NOT NULL,
  release_unit_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status varchar(32) NOT NULL DEFAULT 'draft',
  language varchar(24) NOT NULL,
  interview_type varchar(80) NOT NULL,
  time_budget_minutes integer NOT NULL CHECK (time_budget_minutes > 0),
  question_strategy jsonb NOT NULL DEFAULT '{}'::jsonb,
  forbidden_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  recovery_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (job_id, version),
  FOREIGN KEY (organization_id, job_id) REFERENCES jobs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, rubric_version_id) REFERENCES rubric_versions(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, release_unit_id) REFERENCES interview_release_units(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS interview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  interview_plan_id uuid NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'invited',
  current_criterion_key varchar(120),
  remaining_seconds integer,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconnect_count integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, application_id) REFERENCES applications(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, interview_plan_id) REFERENCES interview_plans(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS interview_sessions_application_idx ON interview_sessions(organization_id, application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS interview_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_session_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  candidate_intent varchar(48),
  action varchar(48) NOT NULL,
  criterion_key varchar(120),
  objective varchar(240),
  spoken_text text NOT NULL,
  expected_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  interviewer_trace_reference varchar(512),
  finalized boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interview_session_id, sequence),
  FOREIGN KEY (organization_id, interview_session_id) REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interview_transcript_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_session_id uuid NOT NULL,
  speaker varchar(24) NOT NULL CHECK (speaker IN ('candidate', 'interviewer', 'system')),
  start_ms integer NOT NULL CHECK (start_ms >= 0),
  end_ms integer NOT NULL CHECK (end_ms >= start_ms),
  text text NOT NULL,
  is_final boolean NOT NULL DEFAULT false,
  stt_confidence numeric(5,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, interview_session_id) REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS interview_transcript_session_idx ON interview_transcript_segments(organization_id, interview_session_id, start_ms);

CREATE TABLE IF NOT EXISTS interview_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_session_id uuid NOT NULL,
  criterion_id uuid,
  turn_id uuid,
  transcript_segment_ids uuid[] NOT NULL DEFAULT '{}',
  summary text NOT NULL,
  confidence numeric(5,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, interview_session_id) REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, criterion_id) REFERENCES rubric_criteria(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (turn_id) REFERENCES interview_turns(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS interview_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_session_id uuid NOT NULL,
  rubric_version_id uuid NOT NULL,
  evaluator_version varchar(120) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'draft',
  criterion_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendation varchar(48),
  evaluator_trace_reference varchar(512),
  human_review_state varchar(32) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, interview_session_id) REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, rubric_version_id) REFERENCES rubric_versions(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS interview_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_session_id uuid NOT NULL,
  file_id uuid NOT NULL,
  recording_type varchar(32) NOT NULL,
  participant_scope varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, interview_session_id) REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, file_id) REFERENCES files(organization_id, id) ON DELETE CASCADE
);
