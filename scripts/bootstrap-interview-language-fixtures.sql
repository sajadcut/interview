BEGIN;

UPDATE interview_release_units r
SET language = 'fa',
    updated_at = now()
FROM organizations o
WHERE r.organization_id = o.id
  AND o.slug = :'org_slug'
  AND r.id = '60606060-6060-4060-8060-606060606060'::uuid;

UPDATE interview_plans p
SET language = 'fa',
    question_strategy = jsonb_set(
      COALESCE(p.question_strategy, '{}'::jsonb),
      '{criteria}',
      jsonb_set(
        jsonb_set(
          COALESCE(p.question_strategy->'criteria', '{}'::jsonb),
          '{backend_depth}',
          COALESCE(p.question_strategy->'criteria'->'backend_depth', '{}'::jsonb) ||
            '{"spokenLabel":"مهندسی بک‌اند"}'::jsonb,
          true
        ),
        '{system_design}',
        COALESCE(p.question_strategy->'criteria'->'system_design', '{}'::jsonb) ||
          '{"spokenLabel":"طراحی سیستم"}'::jsonb,
        true
      ),
      true
    ),
    updated_at = now()
FROM organizations o
WHERE p.organization_id = o.id
  AND o.slug = :'org_slug'
  AND p.id = '70707070-7070-4070-8070-707070707070'::uuid;

UPDATE candidates c
SET preferred_language = 'fa',
    updated_at = now()
FROM organizations o
WHERE c.organization_id = o.id
  AND o.slug = :'org_slug'
  AND c.id IN (
    '22222222-2222-4222-8222-222222222222'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid
  );

COMMIT;
