-- Source documents must be attributable for each persisted interviewer turn, not
-- only to the session's mutable last-turn checkpoint.
ALTER TABLE interview_turns
  ADD COLUMN IF NOT EXISTS question_bank_document_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE interview_turns
  ADD CONSTRAINT interview_turns_question_bank_ids_array_check
  CHECK (jsonb_typeof(question_bank_document_ids) = 'array');
COMMENT ON COLUMN interview_turns.question_bank_document_ids IS
  'Per-turn immutable selected question document IDs supplied as bounded model context. Empty for ungrounded/deterministic/lifecycle turns.';
