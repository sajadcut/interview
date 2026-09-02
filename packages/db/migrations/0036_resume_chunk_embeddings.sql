-- Persist real provider-backed resume chunk embeddings without coupling ingestion to a vector extension.

CREATE TABLE IF NOT EXISTS resume_chunk_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resume_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  provider varchar(80) NOT NULL,
  model varchar(240) NOT NULL,
  dimensions integer NOT NULL CHECK (dimensions > 0 AND dimensions <= 8192),
  embedding jsonb NOT NULL CHECK (jsonb_typeof(embedding) = 'array'),
  vector_sha256 varchar(64) NOT NULL CHECK (vector_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, chunk_id),
  FOREIGN KEY (organization_id, resume_id)
    REFERENCES resumes(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, chunk_id)
    REFERENCES resume_chunks(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS resume_chunk_embeddings_resume_idx
  ON resume_chunk_embeddings(organization_id, resume_id, chunk_id);
