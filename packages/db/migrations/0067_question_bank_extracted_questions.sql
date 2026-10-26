ALTER TABLE question_bank_documents
  ADD COLUMN IF NOT EXISTS suggested_questions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE question_bank_documents
  ADD CONSTRAINT question_bank_documents_questions_array_check
  CHECK (jsonb_typeof(suggested_questions) = 'array');
