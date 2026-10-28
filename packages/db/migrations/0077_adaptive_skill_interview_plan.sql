-- Phase 3: fully replayable, immutable, tenant/application-bound adaptive skill plan.
-- Materialize for *all* session admission paths, not only the public API.
CREATE TABLE interview_session_adaptive_plans (
  organization_id uuid NOT NULL,
  interview_session_id uuid NOT NULL,
  contract_version varchar(48) NOT NULL DEFAULT 'adaptive-skill-plan.v1',
  job_id uuid NOT NULL,
  rubric_version_id uuid NOT NULL,
  source_plan_version integer NOT NULL,
  question_selection_snapshot_id uuid,
  question_selection_sha256 char(64),
  criterion_budgets jsonb NOT NULL CHECK (jsonb_typeof(criterion_budgets) = 'array'),
  skill_budgets jsonb NOT NULL CHECK (jsonb_typeof(skill_budgets) = 'array'),
  common_question_version_ids jsonb NOT NULL CHECK (jsonb_typeof(common_question_version_ids) = 'array'),
  adaptive_policy jsonb NOT NULL CHECK (jsonb_typeof(adaptive_policy) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, interview_session_id),
  FOREIGN KEY (organization_id, interview_session_id)
    REFERENCES interview_sessions(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, question_selection_snapshot_id)
    REFERENCES application_question_selection_snapshots(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, rubric_version_id)
    REFERENCES rubric_versions(organization_id,id) ON DELETE CASCADE
);
CREATE TRIGGER interview_skill_plan_immutable
  BEFORE UPDATE OR DELETE ON interview_session_adaptive_plans
  FOR EACH ROW EXECUTE FUNCTION prevent_question_bank_immutable_changes();

-- A question actually spoken verbatim is different from questions merely
-- supplied as bounded LLM prompt context (0076). Preserve both separately.
ALTER TABLE interview_turns
  ADD COLUMN planned_question_version_id uuid;
ALTER TABLE interview_turns
  ADD CONSTRAINT interview_turn_planned_question_version_fk
  FOREIGN KEY (organization_id,planned_question_version_id)
  REFERENCES question_bank_question_versions(organization_id,id)
  ON DELETE SET NULL (planned_question_version_id);
CREATE UNIQUE INDEX interview_turn_no_duplicate_planned_bank_question
  ON interview_turns(organization_id,interview_session_id,planned_question_version_id)
  WHERE planned_question_version_id IS NOT NULL;
ALTER TABLE interview_turns DROP CONSTRAINT interview_turns_question_source_check;
ALTER TABLE interview_turns ADD CONSTRAINT interview_turns_question_source_check
  CHECK (question_source IN (
    'lifecycle','rubric','job_requirement','resume_claim','adaptive_follow_up','question_bank'
  ));

CREATE OR REPLACE FUNCTION create_immutable_session_adaptive_plan()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_plan record;
  criteria_json jsonb;
  skills_json jsonb;
  common_json jsonb;
BEGIN
  SELECT p.job_id, p.rubric_version_id, p.version, p.question_strategy,
         qs.content_sha256, qs.approved_question_versions
    INTO STRICT source_plan
  FROM interview_plans p
  LEFT JOIN application_question_selection_snapshots qs
    ON qs.organization_id=NEW.organization_id
   AND qs.id=NEW.question_selection_snapshot_id
  WHERE p.organization_id=NEW.organization_id AND p.id=NEW.interview_plan_id;

  -- Latest active skill requirements only; older revisions have no authority.
  -- A criterion mapping is honored only for this *pinned* rubric version.
  WITH current_skills AS (
    SELECT DISTINCT ON (r.skill_id) r.*
    FROM job_skill_requirements r
    WHERE r.organization_id=NEW.organization_id AND r.job_id=source_plan.job_id
    ORDER BY r.skill_id,r.requirement_version DESC,r.created_at DESC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'skillId',r.skill_id::text,
    'skillKey',st.skill_key,
    'requiredLevel',r.required_level,
    'required',r.required,
    'weight',r.weight,
    'minimumEvidence',r.minimum_evidence_count,
    'criterionKey',rc.criterion_key,
    'questionVersionIds',(
      SELECT COALESCE(jsonb_agg(q->>'versionId' ORDER BY ordinal),'[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(source_plan.approved_question_versions,'[]'::jsonb))
        WITH ORDINALITY AS selected(q,ordinal)
      WHERE q->>'skillKey'=st.skill_key
    )
  ) ORDER BY r.required DESC,r.weight DESC,st.skill_key),'[]'::jsonb) INTO skills_json
  FROM current_skills r
  JOIN skill_taxonomy st ON st.organization_id=r.organization_id AND st.id=r.skill_id
  LEFT JOIN rubric_criteria rc ON rc.organization_id=r.organization_id
    AND rc.id=r.rubric_criterion_id
    AND rc.rubric_version_id=source_plan.rubric_version_id
  WHERE r.is_active=true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'criterionKey',rc.criterion_key,
      'required',rc.required,
      'minimumEvidence',GREATEST(
        1,
        COALESCE((rc.evidence_policy->>'minimumEvidence')::integer,1),
        COALESCE((
          SELECT max((skill->>'minimumEvidence')::integer)
          FROM jsonb_array_elements(skills_json) skill
          WHERE skill->>'criterionKey'=rc.criterion_key
        ),0)
      ),
      'maxQuestions',LEAST(20,GREATEST(
        2,
        COALESCE((source_plan.question_strategy->>'maxDepth')::integer,3),
        COALESCE((
          SELECT max((skill->>'minimumEvidence')::integer)
          FROM jsonb_array_elements(skills_json) skill
          WHERE skill->>'criterionKey'=rc.criterion_key
        ),0)
      )),
      'skillKeys',COALESCE((
        SELECT jsonb_agg(skill->>'skillKey' ORDER BY skill->>'skillKey')
        FROM jsonb_array_elements(skills_json) skill
        WHERE skill->>'criterionKey'=rc.criterion_key
      ),'[]'::jsonb)
    ) ORDER BY rc.display_order,rc.criterion_key),'[]'::jsonb) INTO criteria_json
  FROM rubric_criteria rc
  WHERE rc.organization_id=NEW.organization_id
    AND rc.rubric_version_id=source_plan.rubric_version_id;

  SELECT COALESCE(jsonb_agg(q->>'versionId' ORDER BY ordinal),'[]'::jsonb)
    INTO common_json
  FROM jsonb_array_elements(COALESCE(source_plan.approved_question_versions,'[]'::jsonb))
    WITH ORDINALITY AS selected(q,ordinal);

  INSERT INTO interview_session_adaptive_plans(
    organization_id,interview_session_id,job_id,rubric_version_id,source_plan_version,
    question_selection_snapshot_id,question_selection_sha256,
    criterion_budgets,skill_budgets,common_question_version_ids,adaptive_policy
  ) VALUES (
    NEW.organization_id,NEW.id,source_plan.job_id,source_plan.rubric_version_id,
    source_plan.version,NEW.question_selection_snapshot_id,source_plan.content_sha256,
    criteria_json,skills_json,common_json,
    jsonb_build_object('commonFirst',true,'deterministicFallback',true,
      'adaptiveOnlyForMissingEvidence',true,'noAutomaticScoring',true,
      'maxReconnects',COALESCE((source_plan.question_strategy->>'maxReconnects')::integer,3))
  );
  RETURN NEW;
END $$;
CREATE TRIGGER interview_session_adaptive_plan_admit
  AFTER INSERT ON interview_sessions
  FOR EACH ROW EXECUTE FUNCTION create_immutable_session_adaptive_plan();

COMMENT ON TABLE interview_session_adaptive_plans IS
  'Immutable Phase-3 session-specific rubric/skill/approved-question budgets; created at admission, with no LLM scoring authority.';
COMMENT ON COLUMN interview_turns.planned_question_version_id IS
  'Exactly the human-approved question version read verbatim as the spoken primary interview turn. Other supplied versions are prompt-context only.';
