-- Resume ingestion: tenant-scoped upload -> extraction -> parsing -> chunks -> evidence -> profile.

ALTER TABLE files
  ADD CONSTRAINT files_org_id_uq UNIQUE (organization_id, id);

ALTER TABLE candidate_experiences
  ADD COLUMN IF NOT EXISTS source_fingerprint varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS candidate_experiences_source_fingerprint_uq
  ON candidate_experiences(organization_id, candidate_id, source_fingerprint)
  WHERE source_fingerprint IS NOT NULL;

INSERT INTO permissions (key, description) VALUES
  ('candidate.resume_manage', 'Upload and process candidate resumes')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'candidate.resume_manage'
WHERE r.key IN ('PLATFORM_ADMIN', 'ORGANIZATION_ADMIN', 'RECRUITER', 'org_admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS resumes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  application_id uuid,
  file_id uuid NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'extracting', 'parsing', 'completed', 'failed')),
  original_filename varchar(500) NOT NULL,
  content_type varchar(200) NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  extractor_version varchar(80),
  parser_version varchar(80),
  structured_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_code varchar(80),
  failure_message varchar(500),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, candidate_id, sha256),
  FOREIGN KEY (organization_id, candidate_id)
    REFERENCES candidates(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, application_id)
    REFERENCES applications(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, file_id)
    REFERENCES files(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS resumes_candidate_created_idx
  ON resumes(organization_id, candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS resumes_application_created_idx
  ON resumes(organization_id, application_id, created_at DESC)
  WHERE application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS resumes_status_idx
  ON resumes(organization_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS resume_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resume_id uuid NOT NULL,
  text_content text NOT NULL,
  text_sha256 varchar(64) NOT NULL,
  page_count integer,
  extractor_version varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, resume_id),
  FOREIGN KEY (organization_id, resume_id)
    REFERENCES resumes(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS resume_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resume_id uuid NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  text_content text NOT NULL,
  content_hash varchar(64) NOT NULL,
  start_char integer NOT NULL CHECK (start_char >= 0),
  end_char integer NOT NULL CHECK (end_char > start_char),
  embedding_state varchar(24) NOT NULL DEFAULT 'not_enabled'
    CHECK (embedding_state IN ('not_enabled', 'pending', 'completed', 'failed')),
  embedding_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, resume_id, chunk_index),
  FOREIGN KEY (organization_id, resume_id)
    REFERENCES resumes(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS resume_chunks_resume_idx
  ON resume_chunks(organization_id, resume_id, chunk_index);

CREATE UNIQUE INDEX IF NOT EXISTS evidence_resume_source_uq
  ON evidence(organization_id, candidate_id, source_reference)
  WHERE source_type = 'resume';
