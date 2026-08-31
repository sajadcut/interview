BEGIN;

-- Deterministic development-only IDs. This file is executed only after domain migrations exist.
INSERT INTO jobs (
  id, organization_id, title, status, department, location, seniority, summary, created_by_user_id
)
SELECT
  '11111111-1111-4111-8111-111111111111'::uuid,
  o.id,
  'Senior Backend Engineer',
  'open',
  'Engineering',
  'Tehran / Remote',
  'Senior',
  'Design and operate reliable backend systems, lead technical decisions, and mentor engineers.',
  u.id
FROM organizations o
JOIN users u ON u.email = :'user_email'
WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  status = EXCLUDED.status,
  department = EXCLUDED.department,
  location = EXCLUDED.location,
  seniority = EXCLUDED.seniority,
  summary = EXCLUDED.summary,
  updated_at = now();

INSERT INTO job_requirements (id, organization_id, job_id, requirement_type, name, description, weight, minimum_years)
SELECT v.id, o.id, '11111111-1111-4111-8111-111111111111'::uuid, v.requirement_type, v.name, v.description, v.weight, v.minimum_years
FROM organizations o
CROSS JOIN (VALUES
  ('11111111-1111-4111-8111-111111111101'::uuid, 'must_have', '.NET / C#', 'Production backend engineering depth', 2.0::numeric, 5.0::numeric),
  ('11111111-1111-4111-8111-111111111102'::uuid, 'must_have', 'System Design', 'Scalable distributed system design', 2.0::numeric, 4.0::numeric),
  ('11111111-1111-4111-8111-111111111103'::uuid, 'nice_to_have', 'Kubernetes', 'Production container orchestration experience', 1.0::numeric, 2.0::numeric)
) AS v(id, requirement_type, name, description, weight, minimum_years)
WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description, weight = EXCLUDED.weight, minimum_years = EXCLUDED.minimum_years;

INSERT INTO rubrics (id, organization_id, job_id, name, status)
SELECT '55555555-5555-4555-8555-555555555555'::uuid, o.id, '11111111-1111-4111-8111-111111111111'::uuid, 'Senior Backend v1', 'published'
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = now();

INSERT INTO rubric_versions (id, organization_id, rubric_id, version, status, published_at)
SELECT '66666666-6666-4666-8666-666666666666'::uuid, o.id, '55555555-5555-4555-8555-555555555555'::uuid, 1, 'published', now()
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, published_at = EXCLUDED.published_at;

INSERT INTO rubric_criteria (
  id, organization_id, rubric_version_id, criterion_key, label, description, weight, required, evidence_policy, display_order
)
SELECT v.id, o.id, '66666666-6666-4666-8666-666666666666'::uuid, v.criterion_key, v.label, v.description, v.weight, true, v.evidence_policy::jsonb, v.display_order
FROM organizations o
CROSS JOIN (VALUES
  ('77777777-7777-4777-8777-777777777777'::uuid, 'backend_depth', 'Backend engineering', 'Production design, debugging and delivery depth', 2.0::numeric, '{"minimumEvidence":1}', 1),
  ('88888888-8888-4888-8888-888888888888'::uuid, 'system_design', 'System design', 'Trade-offs, scalability and reliability reasoning', 2.0::numeric, '{"minimumEvidence":1}', 2)
) AS v(id, criterion_key, label, description, weight, evidence_policy, display_order)
WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, weight = EXCLUDED.weight, evidence_policy = EXCLUDED.evidence_policy;

INSERT INTO candidates (id, organization_id, display_name, primary_email, "current_role", current_company, location, preferred_language)
SELECT v.id, o.id, v.display_name, v.primary_email, v.current_role, v.current_company, 'Tehran, Iran', 'fa'
FROM organizations o
CROSS JOIN (VALUES
  ('22222222-2222-4222-8222-222222222222'::uuid, 'Ali Rahimi', 'ali.rahimi@example.local', 'Backend Lead', 'Digikala'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'Sara Mohammadi', 'sara.mohammadi@example.local', 'Senior Developer', 'Snapp'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'Reza Akbari', 'reza.akbari@example.local', 'Software Engineer', 'Tapsi')
) AS v(id, display_name, primary_email, current_role, current_company)
WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  primary_email = EXCLUDED.primary_email,
  "current_role" = EXCLUDED."current_role",
  current_company = EXCLUDED.current_company,
  updated_at = now();

INSERT INTO candidate_skills (id, organization_id, candidate_id, skill_key, skill_label, verification_state, confidence, source_reference)
SELECT v.id, o.id, v.candidate_id, v.skill_key, v.skill_label, v.verification_state, v.confidence, 'development-seed'
FROM organizations o
CROSS JOIN (VALUES
  ('22222222-2222-4222-8222-222222222201'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'dotnet', '.NET', 'verified', 0.96::numeric),
  ('22222222-2222-4222-8222-222222222202'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'kubernetes', 'Kubernetes', 'verified', 0.88::numeric),
  ('33333333-3333-4333-8333-333333333301'::uuid, '33333333-3333-4333-8333-333333333333'::uuid, 'dotnet', '.NET', 'verified', 0.91::numeric),
  ('33333333-3333-4333-8333-333333333302'::uuid, '33333333-3333-4333-8333-333333333333'::uuid, 'sql', 'SQL', 'verified', 0.87::numeric),
  ('44444444-4444-4444-8444-444444444401'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, 'docker', 'Docker', 'unverified', 0.74::numeric)
) AS v(id, candidate_id, skill_key, skill_label, verification_state, confidence)
WHERE o.slug = :'org_slug'
ON CONFLICT (candidate_id, skill_key) DO UPDATE SET verification_state = EXCLUDED.verification_state, confidence = EXCLUDED.confidence;

INSERT INTO applications (id, organization_id, job_id, candidate_id, status, pipeline_stage, source, pre_interview_match_score)
SELECT v.id, o.id, '11111111-1111-4111-8111-111111111111'::uuid, v.candidate_id, 'active', v.stage, v.source, v.match_score
FROM organizations o
CROSS JOIN (VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'interview', 'internal_talent_pool', 91.0::numeric),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, '33333333-3333-4333-8333-333333333333'::uuid, 'screening', 'internal_talent_pool', 88.0::numeric),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, 'sourced', 'approved_job_board', 85.0::numeric)
) AS v(id, candidate_id, stage, source, match_score)
WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET pipeline_stage = EXCLUDED.pipeline_stage, source = EXCLUDED.source, pre_interview_match_score = EXCLUDED.pre_interview_match_score, updated_at = now();

INSERT INTO evidence (id, organization_id, candidate_id, application_id, evidence_type, source_type, source_reference, excerpt, occurred_at, metadata)
SELECT v.id, o.id, '22222222-2222-4222-8222-222222222222'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, v.evidence_type, v.source_type, v.source_reference, v.excerpt, now(), v.metadata::jsonb
FROM organizations o
CROSS JOIN (VALUES
  ('99999999-9999-4999-8999-999999999991'::uuid, 'resume_claim', 'resume', 'resume:ali-rahimi#experience-2', 'Led migration of backend services to containerized workloads.', '{"developmentFixture":true}'),
  ('99999999-9999-4999-8999-999999999992'::uuid, 'interview_answer', 'interview', 'interview:ali-rahimi#turn-4', 'Explained queue backpressure, idempotency and observability trade-offs.', '{"developmentFixture":true}')
) AS v(id, evidence_type, source_type, source_reference, excerpt, metadata)
WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET excerpt = EXCLUDED.excerpt, metadata = EXCLUDED.metadata;

INSERT INTO candidate_criterion_evaluations (
  id, organization_id, application_id, rubric_version_id, criterion_id, evaluator_type, evaluator_version, score, confidence, rationale, evidence_ids, review_state
)
SELECT v.id, o.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '66666666-6666-4666-8666-666666666666'::uuid, v.criterion_id, 'ai', 'development-evaluator-v1', v.score, v.confidence, v.rationale, v.evidence_ids, 'pending_human_review'
FROM organizations o
CROSS JOIN (VALUES
  ('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid, '77777777-7777-4777-8777-777777777777'::uuid, 93.0::numeric, 0.88::numeric, 'Strong production backend evidence.', ARRAY['99999999-9999-4999-8999-999999999991'::uuid]),
  ('aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid, '88888888-8888-4888-8888-888888888888'::uuid, 89.0::numeric, 0.82::numeric, 'Good system-design trade-off reasoning.', ARRAY['99999999-9999-4999-8999-999999999992'::uuid])
) AS v(id, criterion_id, score, confidence, rationale, evidence_ids)
WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO NOTHING;

INSERT INTO scorecards (id, organization_id, application_id, rubric_version_id, overall_score, recommendation, algorithm_version, review_state)
SELECT 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid, o.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '66666666-6666-4666-8666-666666666666'::uuid, 91.0, 'strong_recommend', 'weighted-evidence-v1', 'pending_human_review'
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET overall_score = EXCLUDED.overall_score, recommendation = EXCLUDED.recommendation, review_state = EXCLUDED.review_state;

INSERT INTO talent_pool_entries (id, organization_id, candidate_id, status, tags, notes)
SELECT v.id, o.id, v.candidate_id, 'active', v.tags, 'Development seed candidate'
FROM organizations o
CROSS JOIN (VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, ARRAY['backend','senior']),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'::uuid, '33333333-3333-4333-8333-333333333333'::uuid, ARRAY['backend','talent-pool'])
) AS v(id, candidate_id, tags)
WHERE o.slug = :'org_slug'
ON CONFLICT (organization_id, candidate_id) DO UPDATE SET status = 'active', tags = EXCLUDED.tags, updated_at = now();

INSERT INTO knowledge_items (id, organization_id, job_id, knowledge_type, title, body, status, approved_by_user_id, approved_at)
SELECT '10101010-1010-4010-8010-101010101010'::uuid, o.id, '11111111-1111-4111-8111-111111111111'::uuid, 'job_faq', 'Remote policy', 'This development fixture role supports hybrid or remote work from approved locations.', 'approved', u.id, now()
FROM organizations o JOIN users u ON u.email = :'user_email'
WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, status = EXCLUDED.status, approved_by_user_id = EXCLUDED.approved_by_user_id, approved_at = EXCLUDED.approved_at;

INSERT INTO conversations (id, organization_id, candidate_id, application_id, channel, status)
SELECT '20202020-2020-4020-8020-202020202020'::uuid, o.id, '22222222-2222-4222-8222-222222222222'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'email', 'open'
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET status = 'open', updated_at = now();

INSERT INTO messages (id, organization_id, conversation_id, direction, sender_type, body, grounding_references, approval_state, sent_at)
SELECT '21212121-2121-4121-8121-212121212121'::uuid, o.id, '20202020-2020-4020-8020-202020202020'::uuid, 'outbound', 'human', 'The role supports hybrid or remote work from approved locations.', '["knowledge:10101010-1010-4010-8010-101010101010"]'::jsonb, 'approved', now()
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, grounding_references = EXCLUDED.grounding_references, approval_state = EXCLUDED.approval_state;

INSERT INTO screening_sessions (id, organization_id, application_id, status, rules_version, answers, hard_filter_result, recommendation, review_state)
SELECT '30303030-3030-4030-8030-303030303030'::uuid, o.id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'completed', 'backend-screen-v1', '{"yearsExperience":6,"workAuthorization":true}'::jsonb, '{"passed":true,"failedKeys":[]}'::jsonb, 'advance', 'pending_human_review'
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET answers = EXCLUDED.answers, hard_filter_result = EXCLUDED.hard_filter_result, recommendation = EXCLUDED.recommendation, review_state = EXCLUDED.review_state, updated_at = now();

INSERT INTO scheduling_requests (id, organization_id, application_id, interview_type, status, timezone, proposed_slots, selected_start, selected_end, reminder_policy)
SELECT '40404040-4040-4040-8040-404040404040'::uuid, o.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'technical', 'confirmed', 'Asia/Tehran', '[]'::jsonb, now() + interval '1 day', now() + interval '1 day 45 minutes', '{"candidateReminderHours":[24,2]}'::jsonb
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, selected_start = EXCLUDED.selected_start, selected_end = EXCLUDED.selected_end, updated_at = now();

INSERT INTO consent_records (id, organization_id, candidate_id, application_id, purpose, policy_version, recording_allowed, transcript_allowed, granted_at, metadata)
SELECT '50505050-5050-4050-8050-505050505050'::uuid, o.id, '22222222-2222-4222-8222-222222222222'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'ai_interview', 'candidate-consent-v1', true, true, now(), '{"developmentFixture":true}'::jsonb
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET recording_allowed = EXCLUDED.recording_allowed, transcript_allowed = EXCLUDED.transcript_allowed, withdrawn_at = NULL;

INSERT INTO interview_release_units (id, organization_id, job_family, language, interview_type, rubric_version_family, interviewer_policy_version, speech_avatar_stack_version, evaluator_version, lifecycle_stage)
SELECT '60606060-6060-4060-8060-606060606060'::uuid, o.id, 'Software Engineering / Backend', 'fa', 'technical_screen', 'backend-senior', 'interviewer-policy-v1', 'speech-avatar-dev-v1', 'development-evaluator-v1', 'DEV_ONLY'
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET lifecycle_stage = 'DEV_ONLY', updated_at = now();

INSERT INTO interview_plans (id, organization_id, job_id, rubric_version_id, release_unit_id, version, status, language, interview_type, time_budget_minutes, question_strategy, forbidden_topics, recovery_policy)
SELECT '70707070-7070-4070-8070-707070707070'::uuid, o.id, '11111111-1111-4111-8111-111111111111'::uuid, '66666666-6666-4666-8666-666666666666'::uuid, '60606060-6060-4060-8060-606060606060'::uuid, 1, 'published', 'fa', 'technical_screen', 45, '{"requiredCriteria":["backend_depth","system_design"],"adaptiveFollowups":true}'::jsonb, '["protected characteristics","non-job-relevant medical questions"]'::jsonb, '{"reconnect":"resume_checkpoint","lowConfidence":"human_review"}'::jsonb
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET question_strategy = EXCLUDED.question_strategy, forbidden_topics = EXCLUDED.forbidden_topics, recovery_policy = EXCLUDED.recovery_policy, updated_at = now();

INSERT INTO interview_sessions (id, organization_id, application_id, interview_plan_id, status, current_criterion_key, remaining_seconds, checkpoint, reconnect_count, started_at, completed_at)
SELECT '80808080-8080-4080-8080-808080808080'::uuid, o.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '70707070-7070-4070-8070-707070707070'::uuid, 'completed', 'system_design', 0, '{"developmentFixture":true,"evidenceCoverage":{"backend_depth":1,"system_design":1}}'::jsonb, 0, now() - interval '50 minutes', now() - interval '5 minutes'
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, checkpoint = EXCLUDED.checkpoint, completed_at = EXCLUDED.completed_at, updated_at = now();

INSERT INTO interview_transcript_segments (id, organization_id, interview_session_id, speaker, start_ms, end_ms, text, is_final, stt_confidence)
SELECT v.id, o.id, '80808080-8080-4080-8080-808080808080'::uuid, v.speaker, v.start_ms, v.end_ms, v.text, true, v.confidence
FROM organizations o
CROSS JOIN (VALUES
  ('81818181-8181-4181-8181-818181818181'::uuid, 'interviewer', 120000, 128000, 'یک نمونه از تصمیم معماری مهمی که در production گرفتی توضیح می‌دهی؟', 0.99::numeric),
  ('82828282-8282-4282-8282-828282828282'::uuid, 'candidate', 129000, 168000, 'برای کنترل backpressure صف را partition کردیم و idempotency key و metrics اضافه کردیم تا retry امن باشد.', 0.91::numeric)
) AS v(id, speaker, start_ms, end_ms, text, confidence)
WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, is_final = true, stt_confidence = EXCLUDED.stt_confidence;

INSERT INTO interview_evidence (id, organization_id, interview_session_id, criterion_id, transcript_segment_ids, summary, confidence)
SELECT '83838383-8383-4383-8383-838383838383'::uuid, o.id, '80808080-8080-4080-8080-808080808080'::uuid, '88888888-8888-4888-8888-888888888888'::uuid, ARRAY['82828282-8282-4282-8282-828282828282'::uuid], 'Candidate described concrete backpressure, idempotency and observability trade-offs.', 0.86
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET summary = EXCLUDED.summary, confidence = EXCLUDED.confidence;

INSERT INTO interview_evaluations (id, organization_id, interview_session_id, rubric_version_id, evaluator_version, status, criterion_results, recommendation, evaluator_trace_reference, human_review_state)
SELECT '84848484-8484-4484-8484-848484848484'::uuid, o.id, '80808080-8080-4080-8080-808080808080'::uuid, '66666666-6666-4666-8666-666666666666'::uuid, 'development-evaluator-v1', 'draft', '[{"criterion":"system_design","score":89,"evidenceIds":["83838383-8383-4383-8383-838383838383"]}]'::jsonb, 'advance', 'development-fixture', 'pending'
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET criterion_results = EXCLUDED.criterion_results, recommendation = EXCLUDED.recommendation, human_review_state = EXCLUDED.human_review_state;

INSERT INTO assessments (id, organization_id, job_id, rubric_version_id, assessment_type, title, instructions, status, time_limit_minutes, runner_policy, version)
SELECT '90909090-9090-4090-8090-909090909090'::uuid, o.id, '11111111-1111-4111-8111-111111111111'::uuid, '66666666-6666-4666-8666-666666666666'::uuid, 'coding', 'Backend reliability exercise', 'Implement an idempotent request handler and explain failure handling.', 'published', 60, '{"runner":"isolated_required","network":"disabled"}'::jsonb, 1
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET instructions = EXCLUDED.instructions, runner_policy = EXCLUDED.runner_policy, updated_at = now();

INSERT INTO assessment_sessions (id, organization_id, assessment_id, application_id, status, started_at, submitted_at, integrity_signals, candidate_notice_version)
SELECT '91919191-9191-4191-8191-919191919191'::uuid, o.id, '90909090-9090-4090-8090-909090909090'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'completed', now() - interval '2 hours', now() - interval '1 hour', '[{"type":"focus_change","count":2,"reviewOnly":true}]'::jsonb, 'assessment-notice-v1'
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, integrity_signals = EXCLUDED.integrity_signals, updated_at = now();

INSERT INTO assessment_submissions (id, organization_id, assessment_session_id, language, source_text, submitted_at)
SELECT '92929292-9292-4292-8292-929292929292'::uuid, o.id, '91919191-9191-4191-8191-919191919191'::uuid, 'csharp', '// development fixture submission', now() - interval '1 hour'
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET source_text = EXCLUDED.source_text, submitted_at = EXCLUDED.submitted_at;

INSERT INTO assessment_results (id, organization_id, assessment_session_id, submission_id, runner_type, runner_version, status, passed_tests, total_tests, raw_score, normalized_score, details)
SELECT '93939393-9393-4393-8393-939393939393'::uuid, o.id, '91919191-9191-4191-8191-919191919191'::uuid, '92929292-9292-4292-8292-929292929292'::uuid, 'development_fixture_external', 'v1', 'completed', 8, 10, 8, 80, '{"developmentFixture":true,"coreApiExecutedCode":false}'::jsonb
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO UPDATE SET passed_tests = EXCLUDED.passed_tests, total_tests = EXCLUDED.total_tests, normalized_score = EXCLUDED.normalized_score, details = EXCLUDED.details;

INSERT INTO assessment_evidence_links (id, organization_id, assessment_result_id, evidence_id, criterion_id)
SELECT '94949494-9494-4494-8494-949494949494'::uuid, o.id, '93939393-9393-4393-8393-939393939393'::uuid, '99999999-9999-4999-8999-999999999991'::uuid, '77777777-7777-4777-8777-777777777777'::uuid
FROM organizations o WHERE o.slug = :'org_slug'
ON CONFLICT (id) DO NOTHING;

COMMIT;
