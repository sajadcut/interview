-- Pin the exact immutable application question selection at session creation.
-- Every session creation path (API, assignment, supervised pilot) uses this trigger.
ALTER TABLE interview_sessions
  ADD COLUMN IF NOT EXISTS question_selection_snapshot_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS question_snapshot_app_id_uq
  ON application_question_selection_snapshots(organization_id,application_id,id);
ALTER TABLE interview_sessions
  ADD CONSTRAINT interview_sessions_question_selection_snapshot_fk
  FOREIGN KEY (organization_id,application_id,question_selection_snapshot_id)
  REFERENCES application_question_selection_snapshots(organization_id,application_id,id)
  ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION pin_interview_session_question_selection()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serialize session admission with QuestionBankService.saveSelection's
  -- application-level lock. A save after admission sees the new session and fails.
  PERFORM 1 FROM applications
    WHERE organization_id=NEW.organization_id AND id=NEW.application_id
    FOR UPDATE;
  -- A published plan for a different job or superseded rubric must not be
  -- assigned to an application. The application's published rubric pin wins.
  IF NOT EXISTS (
    SELECT 1 FROM applications a
    JOIN interview_plans p ON p.organization_id=a.organization_id
      AND p.job_id=a.job_id AND p.rubric_version_id=a.rubric_version_id
    WHERE a.organization_id=NEW.organization_id AND a.id=NEW.application_id
      AND p.id=NEW.interview_plan_id
  ) THEN
    RAISE EXCEPTION 'Interview plan must match the application pinned job and rubric version'
      USING ERRCODE='23514';
  END IF;
  SELECT id INTO NEW.question_selection_snapshot_id
    FROM application_question_selection_snapshots
    WHERE organization_id=NEW.organization_id AND application_id=NEW.application_id
    ORDER BY snapshot_version DESC
    LIMIT 1;
  RETURN NEW;
END $$;
CREATE TRIGGER interview_session_pin_question_snapshot
  BEFORE INSERT ON interview_sessions
  FOR EACH ROW EXECUTE FUNCTION pin_interview_session_question_selection();

CREATE OR REPLACE FUNCTION reject_interview_session_question_rebind()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.question_selection_snapshot_id IS DISTINCT FROM OLD.question_selection_snapshot_id THEN
    RAISE EXCEPTION 'Interview question snapshot cannot be rebound after session creation'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER interview_session_question_snapshot_immutable
  BEFORE UPDATE OF question_selection_snapshot_id ON interview_sessions
  FOR EACH ROW EXECUTE FUNCTION reject_interview_session_question_rebind();

ALTER TABLE interview_turns
  ADD COLUMN IF NOT EXISTS question_bank_question_version_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE interview_turns
  ADD CONSTRAINT interview_turns_question_version_ids_array_check
  CHECK (jsonb_typeof(question_bank_question_version_ids) = 'array');
COMMENT ON COLUMN interview_sessions.question_selection_snapshot_id IS
  'Session-pinned immutable selection, never the mutable application document picker.';
COMMENT ON COLUMN interview_turns.question_bank_question_version_ids IS
  'Approved immutable question version IDs actually supplied as model context for this turn; never automatic candidate evidence.';
