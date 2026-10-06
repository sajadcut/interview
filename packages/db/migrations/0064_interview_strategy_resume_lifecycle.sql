ALTER TABLE interview_turns
  ADD COLUMN IF NOT EXISTS turn_kind varchar(32) NOT NULL DEFAULT 'planned_criterion',
  ADD COLUMN IF NOT EXISTS question_source varchar(32) NOT NULL DEFAULT 'rubric',
  ADD COLUMN IF NOT EXISTS resume_claim_id uuid;

ALTER TABLE interview_turns
  DROP CONSTRAINT IF EXISTS interview_turns_turn_kind_check,
  DROP CONSTRAINT IF EXISTS interview_turns_question_source_check;

ALTER TABLE interview_turns
  ADD CONSTRAINT interview_turns_turn_kind_check CHECK (
    turn_kind IN (
      'introduction',
      'planned_criterion',
      'resume_validation',
      'adaptive_follow_up',
      'transition',
      'candidate_question',
      'closing'
    )
  ),
  ADD CONSTRAINT interview_turns_question_source_check CHECK (
    question_source IN (
      'lifecycle',
      'rubric',
      'job_requirement',
      'resume_claim',
      'adaptive_follow_up'
    )
  );

CREATE INDEX IF NOT EXISTS interview_turns_resume_claim_idx
  ON interview_turns(organization_id, interview_session_id, resume_claim_id)
  WHERE resume_claim_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS interview_turns_single_lifecycle_turn_idx
  ON interview_turns(organization_id, interview_session_id, turn_kind)
  WHERE turn_kind IN ('introduction', 'candidate_question', 'closing');

ALTER TABLE interview_transcript_segments
  ADD COLUMN IF NOT EXISTS lifecycle_role varchar(32) NOT NULL DEFAULT 'interview',
  ADD COLUMN IF NOT EXISTS interview_turn_id uuid;

ALTER TABLE interview_transcript_segments
  DROP CONSTRAINT IF EXISTS interview_transcript_segments_lifecycle_role_check;

ALTER TABLE interview_transcript_segments
  ADD CONSTRAINT interview_transcript_segments_lifecycle_role_check CHECK (
    lifecycle_role IN (
      'introduction',
      'interview',
      'wrap_up',
      'candidate_question',
      'closing'
    )
  );

CREATE INDEX IF NOT EXISTS interview_transcript_segments_lifecycle_idx
  ON interview_transcript_segments(organization_id, interview_session_id, lifecycle_role, start_ms);

CREATE UNIQUE INDEX IF NOT EXISTS interview_transcript_segments_lifecycle_turn_idx
  ON interview_transcript_segments(organization_id, interview_session_id, interview_turn_id)
  WHERE interview_turn_id IS NOT NULL AND lifecycle_role <> 'interview';

COMMENT ON COLUMN interview_turns.turn_kind IS
  'Server-selected interview turn kind. The LLM may render spoken text but cannot select lifecycle, rubric, resume or follow-up authority.';
COMMENT ON COLUMN interview_turns.question_source IS
  'Authoritative source selected by Interview Brain: lifecycle, rubric, job requirement, resume claim, or adaptive follow-up.';
COMMENT ON COLUMN interview_turns.resume_claim_id IS
  'Optional reference to an evidence.id row whose source is the candidate resume. Validated in application code before persistence.';
COMMENT ON COLUMN interview_transcript_segments.lifecycle_role IS
  'Lifecycle role used to keep introductions, candidate-question wrap-up and closing out of evaluation evidence.';
COMMENT ON COLUMN interview_transcript_segments.interview_turn_id IS
  'Optional originating interview_turn id for deterministic lifecycle and interviewer transcript idempotency.';
