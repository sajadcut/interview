CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  storage_key varchar(500) NOT NULL,
  original_name varchar(500) NOT NULL,
  mime_type varchar(200) NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_org_idx ON files(organization_id);
CREATE INDEX IF NOT EXISTS files_storage_key_idx ON files(storage_key);
