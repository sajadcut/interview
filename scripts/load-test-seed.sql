\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE _load_test_context ON COMMIT DROP AS
SELECT o.id AS organization_id, u.id AS user_id
FROM organizations o
JOIN memberships m
  ON m.organization_id = o.id AND m.status = 'active'
JOIN users u
  ON u.id = m.user_id AND u.email = :'user_email'
WHERE o.slug = :'org_slug'
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _load_test_context) THEN
    RAISE EXCEPTION 'load-test organization/user fixture was not found';
  END IF;
END $$;

INSERT INTO jobs (
  id, organization_id, title, status, department, location, seniority, summary, created_by_user_id
)
SELECT
  '90909090-9090-4090-8090-909090909090'::uuid,
  context.organization_id,
  'Load Test Read Fixture',
  'open',
  'Performance Engineering',
  'CI / Local',
  'Synthetic',
  'Deterministic API/DB load-test fixture. Not production recruiting data.',
  context.user_id
FROM _load_test_context context
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  status = EXCLUDED.status,
  department = EXCLUDED.department,
  location = EXCLUDED.location,
  seniority = EXCLUDED.seniority,
  summary = EXCLUDED.summary,
  updated_at = now();

INSERT INTO jobs (
  id, organization_id, title, status, department, location, seniority, summary, created_by_user_id
)
SELECT
  md5('api-load-write-job-' || series.value::text)::uuid,
  context.organization_id,
  'Load Test Write Job ' || lpad(series.value::text, 3, '0'),
  'draft',
  'Performance Engineering',
  'CI / Local',
  'Synthetic',
  'Mutable fixture used to distribute audited write load.',
  context.user_id
FROM _load_test_context context
CROSS JOIN generate_series(1, :job_count::int) AS series(value)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  status = EXCLUDED.status,
  department = EXCLUDED.department,
  location = EXCLUDED.location,
  seniority = EXCLUDED.seniority,
  summary = EXCLUDED.summary,
  updated_at = now();

INSERT INTO candidates (
  id, organization_id, display_name, primary_email, "current_role", current_company, location, preferred_language
)
SELECT
  md5('api-load-candidate-' || series.value::text)::uuid,
  context.organization_id,
  'Load Candidate ' || lpad(series.value::text, 6, '0'),
  'load-test-' || series.value::text || '@example.local',
  'Backend Engineer',
  'Synthetic Fixture',
  'CI / Local',
  'en'
FROM _load_test_context context
CROSS JOIN generate_series(1, :candidate_count::int) AS series(value)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  primary_email = EXCLUDED.primary_email,
  "current_role" = EXCLUDED."current_role",
  current_company = EXCLUDED.current_company,
  location = EXCLUDED.location,
  preferred_language = EXCLUDED.preferred_language,
  updated_at = now();

INSERT INTO applications (
  id, organization_id, job_id, candidate_id, status, pipeline_stage, source, pre_interview_match_score
)
SELECT
  md5('api-load-application-' || series.value::text)::uuid,
  context.organization_id,
  '90909090-9090-4090-8090-909090909090'::uuid,
  md5('api-load-candidate-' || series.value::text)::uuid,
  'active',
  CASE series.value % 4
    WHEN 0 THEN 'screening'
    WHEN 1 THEN 'interview'
    WHEN 2 THEN 'review'
    ELSE 'sourced'
  END,
  'internal_talent_pool',
  (60 + (series.value % 41))::numeric
FROM _load_test_context context
CROSS JOIN generate_series(1, :candidate_count::int) AS series(value)
ON CONFLICT (id) DO UPDATE SET
  job_id = EXCLUDED.job_id,
  candidate_id = EXCLUDED.candidate_id,
  status = EXCLUDED.status,
  pipeline_stage = EXCLUDED.pipeline_stage,
  source = EXCLUDED.source,
  pre_interview_match_score = EXCLUDED.pre_interview_match_score,
  updated_at = now();

INSERT INTO candidate_skills (
  id, organization_id, candidate_id, skill_key, skill_label, verification_state, confidence, source_reference
)
SELECT
  md5('api-load-skill-' || series.value::text || '-' || skill.skill_key)::uuid,
  context.organization_id,
  md5('api-load-candidate-' || series.value::text)::uuid,
  skill.skill_key,
  skill.skill_label,
  'verified',
  skill.confidence,
  'api-load-test'
FROM _load_test_context context
CROSS JOIN generate_series(1, :candidate_count::int) AS series(value)
CROSS JOIN LATERAL (
  VALUES
    ('postgres', 'PostgreSQL', 0.91::numeric),
    ('api_design', 'API Design', 0.87::numeric)
) AS skill(skill_key, skill_label, confidence)
ON CONFLICT (candidate_id, skill_key) DO UPDATE SET
  skill_label = EXCLUDED.skill_label,
  verification_state = EXCLUDED.verification_state,
  confidence = EXCLUDED.confidence,
  source_reference = EXCLUDED.source_reference;

COMMIT;

SELECT json_build_object(
  'organizationSlug', :'org_slug',
  'candidateCount', :candidate_count::int,
  'writeJobCount', :job_count::int,
  'readFixtureJobId', '90909090-9090-4090-8090-909090909090'
)::text;
