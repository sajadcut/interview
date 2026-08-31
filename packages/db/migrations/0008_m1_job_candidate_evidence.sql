CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title varchar(240) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'draft',
  department varchar(160),
  location varchar(240),
  seniority varchar(80),
  summary text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS jobs_org_status_idx ON jobs(organization_id, status);

CREATE TABLE IF NOT EXISTS job_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  requirement_type varchar(24) NOT NULL CHECK (requirement_type IN ('must_have', 'nice_to_have')),
  name varchar(240) NOT NULL,
  description text,
  weight numeric(6,3) NOT NULL DEFAULT 1 CHECK (weight > 0),
  minimum_years numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, job_id) REFERENCES jobs(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS job_requirements_job_idx ON job_requirements(organization_id, job_id);

CREATE TABLE IF NOT EXISTS rubrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  name varchar(240) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, job_id) REFERENCES jobs(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rubric_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rubric_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status varchar(32) NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (rubric_id, version),
  FOREIGN KEY (organization_id, rubric_id) REFERENCES rubrics(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rubric_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rubric_version_id uuid NOT NULL,
  criterion_key varchar(120) NOT NULL,
  label varchar(240) NOT NULL,
  description text,
  weight numeric(6,3) NOT NULL CHECK (weight > 0),
  required boolean NOT NULL DEFAULT true,
  evidence_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rubric_version_id, criterion_key),
  FOREIGN KEY (organization_id, rubric_version_id) REFERENCES rubric_versions(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name varchar(240) NOT NULL,
  primary_email varchar(320),
  primary_phone varchar(80),
  "current_role" varchar(240),
  current_company varchar(240),
  location varchar(240),
  preferred_language varchar(16),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS candidates_org_name_idx ON candidates(organization_id, display_name);

CREATE TABLE IF NOT EXISTS candidate_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  identity_type varchar(48) NOT NULL,
  normalized_value varchar(512) NOT NULL,
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, identity_type, normalized_value),
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidates(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS candidate_experiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  company varchar(240) NOT NULL,
  title varchar(240) NOT NULL,
  started_on date,
  ended_on date,
  description text,
  source_reference varchar(512),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidates(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS candidate_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  skill_key varchar(160) NOT NULL,
  skill_label varchar(200) NOT NULL,
  verification_state varchar(32) NOT NULL DEFAULT 'unverified',
  confidence numeric(5,4),
  source_reference varchar(512),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, skill_key),
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidates(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'active',
  pipeline_stage varchar(80) NOT NULL DEFAULT 'new',
  source varchar(120),
  pre_interview_match_score numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (job_id, candidate_id),
  FOREIGN KEY (organization_id, job_id) REFERENCES jobs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidates(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS applications_org_job_stage_idx ON applications(organization_id, job_id, pipeline_stage);
CREATE INDEX IF NOT EXISTS applications_org_candidate_idx ON applications(organization_id, candidate_id);

CREATE TABLE IF NOT EXISTS evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  application_id uuid,
  evidence_type varchar(64) NOT NULL,
  source_type varchar(64) NOT NULL,
  source_reference varchar(512) NOT NULL,
  excerpt text,
  occurred_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidates(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, application_id) REFERENCES applications(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS evidence_application_idx ON evidence(organization_id, application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS candidate_criterion_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  rubric_version_id uuid NOT NULL,
  criterion_id uuid NOT NULL,
  evaluator_type varchar(32) NOT NULL CHECK (evaluator_type IN ('human', 'ai')),
  evaluator_version varchar(120),
  score numeric(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  confidence numeric(5,4),
  rationale text,
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  review_state varchar(32) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, application_id) REFERENCES applications(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, rubric_version_id) REFERENCES rubric_versions(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, criterion_id) REFERENCES rubric_criteria(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS criterion_evaluations_application_idx ON candidate_criterion_evaluations(organization_id, application_id);

CREATE TABLE IF NOT EXISTS scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  rubric_version_id uuid NOT NULL,
  overall_score numeric(5,2) NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  recommendation varchar(48) NOT NULL,
  algorithm_version varchar(80) NOT NULL,
  review_state varchar(32) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, application_id) REFERENCES applications(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, rubric_version_id) REFERENCES rubric_versions(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS score_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scorecard_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_score numeric(5,2) NOT NULL,
  new_score numeric(5,2) NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, scorecard_id) REFERENCES scorecards(organization_id, id) ON DELETE CASCADE
);
