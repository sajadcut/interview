INSERT INTO permissions (key, description) VALUES
  ('assessment.read', 'Read candidate assessments and results'),
  ('assessment.manage', 'Create and manage assessments and review results')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  rubric_version_id uuid,
  assessment_type varchar(64) NOT NULL,
  title varchar(240) NOT NULL,
  instructions text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'draft',
  time_limit_minutes integer CHECK (time_limit_minutes IS NULL OR time_limit_minutes > 0),
  runner_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (job_id, title, version),
  FOREIGN KEY (organization_id, job_id) REFERENCES jobs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, rubric_version_id) REFERENCES rubric_versions(organization_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS assessment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL,
  application_id uuid NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'invited',
  started_at timestamptz,
  submitted_at timestamptz,
  expires_at timestamptz,
  integrity_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidate_notice_version varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, assessment_id) REFERENCES assessments(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, application_id) REFERENCES applications(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS assessment_sessions_application_idx ON assessment_sessions(organization_id, application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assessment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assessment_session_id uuid NOT NULL,
  language varchar(64),
  source_text text,
  artifact_file_id uuid,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, assessment_session_id) REFERENCES assessment_sessions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, artifact_file_id) REFERENCES files(organization_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS assessment_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assessment_session_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  runner_type varchar(64) NOT NULL,
  runner_version varchar(120) NOT NULL,
  status varchar(32) NOT NULL,
  passed_tests integer,
  total_tests integer,
  raw_score numeric(8,3),
  normalized_score numeric(5,2) CHECK (normalized_score IS NULL OR (normalized_score >= 0 AND normalized_score <= 100)),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, assessment_session_id) REFERENCES assessment_sessions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, submission_id) REFERENCES assessment_submissions(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assessment_evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assessment_result_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  criterion_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, assessment_result_id) REFERENCES assessment_results(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, evidence_id) REFERENCES evidence(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, criterion_id) REFERENCES rubric_criteria(organization_id, id) ON DELETE SET NULL
);
