-- Every LLM draft is an unverified immutable question version. The existing
-- human-only question_bank_question_reviews gate controls selection snapshots.
CREATE TABLE IF NOT EXISTS question_bank_llm_provenance (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 document_id uuid NOT NULL,
 version_id uuid NOT NULL,
 skill_id uuid NOT NULL,
 source_text_sha256 char(64) NOT NULL CHECK (source_text_sha256 ~ '^[a-f0-9]{64}$'),
 document_sha256 char(64) NOT NULL CHECK (document_sha256 ~ '^[a-f0-9]{64}$'),
 question_sha256 char(64) NOT NULL CHECK (question_sha256 ~ '^[a-f0-9]{64}$'),
 start_char integer NOT NULL CHECK (start_char >= 0),
 end_char integer NOT NULL CHECK (end_char > start_char AND end_char <= 6000),
 confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
 provider varchar(80) NOT NULL,
 model varchar(160) NOT NULL,
 prompt_version varchar(48) NOT NULL DEFAULT 'question-proposals.v1',
 requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (organization_id,id),
 UNIQUE (organization_id,version_id),
 UNIQUE (organization_id,document_id,source_text_sha256,skill_id,question_sha256),
 FOREIGN KEY (organization_id,version_id)
   REFERENCES question_bank_question_versions(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY (organization_id,skill_id)
   REFERENCES skill_taxonomy(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX question_bank_llm_provenance_document_idx
 ON question_bank_llm_provenance(organization_id,document_id,created_at DESC);
CREATE TRIGGER question_llm_provenance_immutable
 BEFORE UPDATE OR DELETE ON question_bank_llm_provenance
 FOR EACH ROW EXECUTE FUNCTION prevent_question_bank_immutable_changes();
COMMENT ON TABLE question_bank_llm_provenance IS
 'Auditable, source-bound unverified model question suggestions. Approval requires a separate human review; no scoring authority.';
