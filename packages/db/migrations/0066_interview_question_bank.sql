-- Versioned, tenant- and job-scoped interview reference material.
CREATE TABLE question_bank_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  job_id uuid NOT NULL,
  file_id uuid NOT NULL,
  original_name varchar(255) NOT NULL,
  mime_type varchar(120) NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  sha256 char(64) NOT NULL,
  extracted_text text NOT NULL,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, job_id, id),
  FOREIGN KEY (organization_id, job_id) REFERENCES jobs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, file_id) REFERENCES files(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX question_bank_documents_job_idx
  ON question_bank_documents (organization_id, job_id, created_at DESC);
CREATE TABLE application_question_documents (
  organization_id uuid NOT NULL,
  application_id uuid NOT NULL,
  document_id uuid NOT NULL,
  selected_by_user_id uuid,
  selected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, application_id, document_id),
  FOREIGN KEY (organization_id, application_id) REFERENCES applications(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, document_id) REFERENCES question_bank_documents(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX application_question_documents_application_idx
  ON application_question_documents (organization_id, application_id);
COMMENT ON TABLE application_question_documents IS
  'Explicit per-application selection. Changes are denied once a non-cancelled interview session exists; the Interview Brain reads only this frozen selection.';
