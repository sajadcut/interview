CREATE TABLE IF NOT EXISTS question_bank_questions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 job_id uuid NOT NULL,
 document_id uuid NOT NULL,
 origin varchar(24) NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','extracted','llm_proposed')),
 created_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (organization_id,id),
 UNIQUE (organization_id,job_id,id),
 FOREIGN KEY (organization_id,job_id,document_id)
   REFERENCES question_bank_documents(organization_id,job_id,id) ON DELETE CASCADE
);
CREATE INDEX question_bank_questions_job_idx ON question_bank_questions(organization_id,job_id,document_id);

CREATE TABLE IF NOT EXISTS question_bank_question_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 question_id uuid NOT NULL,
 version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
 question_text varchar(600) NOT NULL CHECK (char_length(btrim(question_text)) BETWEEN 12 AND 600),
 skill_id uuid,
 source_excerpt varchar(600),
 created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (organization_id,id),
 UNIQUE (organization_id,question_id,version),
 FOREIGN KEY (organization_id,question_id) REFERENCES question_bank_questions(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY (organization_id,skill_id) REFERENCES skill_taxonomy(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX question_bank_question_versions_latest_idx
 ON question_bank_question_versions(organization_id,question_id,version DESC);

CREATE TABLE IF NOT EXISTS question_bank_question_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 version_id uuid NOT NULL,
 decision varchar(16) NOT NULL CHECK (decision IN ('approved','rejected')),
 reason varchar(1000) NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 8 AND 1000),
 reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (organization_id,id),
 UNIQUE (organization_id,version_id),
 FOREIGN KEY (organization_id,version_id)
   REFERENCES question_bank_question_versions(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX question_bank_question_reviews_version_idx ON question_bank_question_reviews(organization_id,version_id);

CREATE TABLE IF NOT EXISTS application_question_selection_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 application_id uuid NOT NULL,
 job_id uuid NOT NULL,
 snapshot_version integer NOT NULL CHECK (snapshot_version BETWEEN 1 AND 10000),
 document_ids jsonb NOT NULL CHECK (jsonb_typeof(document_ids)='array'),
 approved_question_versions jsonb NOT NULL CHECK (jsonb_typeof(approved_question_versions)='array'),
 content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (organization_id,id),
 UNIQUE (organization_id,application_id,snapshot_version),
 FOREIGN KEY (organization_id,application_id) REFERENCES applications(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY (organization_id,job_id) REFERENCES jobs(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX application_question_selection_snapshots_latest_idx
 ON application_question_selection_snapshots(organization_id,application_id,snapshot_version DESC);

-- A row in any of these audit/version tables may never be modified in place.
CREATE FUNCTION prevent_question_bank_immutable_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Cascade cleanup after deleting an entire parent organization/job/application is allowed.
 -- Direct in-place edits or deletes of a historical audit record are forbidden.
 IF TG_OP='DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Question bank version, review and snapshot records are immutable'
 USING ERRCODE='23514';
END $$;
CREATE TRIGGER question_version_immutable BEFORE UPDATE OR DELETE ON question_bank_question_versions
 FOR EACH ROW EXECUTE FUNCTION prevent_question_bank_immutable_changes();
CREATE TRIGGER question_review_immutable BEFORE UPDATE OR DELETE ON question_bank_question_reviews
 FOR EACH ROW EXECUTE FUNCTION prevent_question_bank_immutable_changes();
CREATE TRIGGER question_snapshot_immutable BEFORE UPDATE OR DELETE ON application_question_selection_snapshots
 FOR EACH ROW EXECUTE FUNCTION prevent_question_bank_immutable_changes();
COMMENT ON TABLE question_bank_question_reviews IS
 'Explicit human approval of individual immutable question versions; LLM text never becomes approved automatically.';
COMMENT ON TABLE application_question_selection_snapshots IS
 'Append-only replayable job-scoped selected source and approved question version snapshot.';
