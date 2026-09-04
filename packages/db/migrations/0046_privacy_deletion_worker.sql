-- Durable, worker-driven privacy deletion with external-storage erasure proof.
-- Extends the privacy receipt introduced in 0032 instead of creating a parallel proof model.

ALTER TABLE privacy_requests
  ADD COLUMN IF NOT EXISTS subject_digest varchar(64);

ALTER TABLE privacy_requests
  DROP CONSTRAINT IF EXISTS privacy_requests_organization_id_candidate_id_fkey;

ALTER TABLE privacy_requests
  ALTER COLUMN candidate_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'privacy_requests_candidate_fk'
  ) THEN
    ALTER TABLE privacy_requests
      ADD CONSTRAINT privacy_requests_candidate_fk
      FOREIGN KEY (organization_id, candidate_id)
      REFERENCES candidates(organization_id, id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE privacy_requests
  ADD CONSTRAINT privacy_requests_subject_digest_check
  CHECK (subject_digest IS NULL OR subject_digest ~ '^[0-9a-f]{64}$') NOT VALID;

CREATE TABLE IF NOT EXISTS privacy_deletion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  privacy_request_id uuid NOT NULL,
  candidate_id uuid,
  subject_digest varchar(64) NOT NULL CHECK (subject_digest ~ '^[0-9a-f]{64}$'),
  state varchar(32) NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'claimed', 'retry_scheduled', 'succeeded', 'failed', 'blocked', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts >= 1 AND max_attempts <= 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  worker_id varchar(160),
  lease_token uuid,
  lease_expires_at timestamptz,
  claimed_at timestamptz,
  started_at timestamptz,
  plan_initialized_at timestamptz,
  planned_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error_code varchar(120),
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, privacy_request_id),
  FOREIGN KEY (organization_id, privacy_request_id)
    REFERENCES privacy_requests(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, candidate_id)
    REFERENCES candidates(organization_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS privacy_deletion_jobs_claim_idx
  ON privacy_deletion_jobs(state, available_at, created_at)
  WHERE state IN ('queued', 'retry_scheduled');
CREATE INDEX IF NOT EXISTS privacy_deletion_jobs_lease_idx
  ON privacy_deletion_jobs(lease_expires_at)
  WHERE state = 'claimed';

CREATE TABLE IF NOT EXISTS privacy_deletion_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deletion_job_id uuid NOT NULL,
  file_id uuid,
  storage_key varchar(500) NOT NULL,
  source_type varchar(160) NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  state varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'deleted', 'failed')),
  last_error text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, deletion_job_id, storage_key),
  FOREIGN KEY (organization_id, deletion_job_id)
    REFERENCES privacy_deletion_jobs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, file_id)
    REFERENCES files(organization_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS privacy_deletion_objects_job_state_idx
  ON privacy_deletion_objects(organization_id, deletion_job_id, state, created_at);

-- 0032 created this table with the original receipt columns. Extend it in-place.
ALTER TABLE privacy_deletion_receipts
  ADD COLUMN IF NOT EXISTS deletion_job_id uuid,
  ADD COLUMN IF NOT EXISTS subject_digest varchar(64),
  ADD COLUMN IF NOT EXISTS deleted_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS storage_object_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storage_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verification jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE privacy_deletion_receipts
SET subject_digest = COALESCE(subject_digest, candidate_reference_hash),
    deleted_counts = CASE
      WHEN deleted_counts = '{}'::jsonb THEN deletion_summary
      ELSE deleted_counts
    END
WHERE subject_digest IS NULL OR deleted_counts = '{}'::jsonb;

ALTER TABLE privacy_deletion_receipts
  ALTER COLUMN candidate_reference_hash DROP NOT NULL,
  ALTER COLUMN requested_at DROP NOT NULL;

ALTER TABLE privacy_deletion_receipts
  ADD CONSTRAINT privacy_deletion_receipts_subject_digest_check
    CHECK (subject_digest IS NULL OR subject_digest ~ '^[0-9a-f]{64}$') NOT VALID,
  ADD CONSTRAINT privacy_deletion_receipts_storage_object_count_check
    CHECK (storage_object_count >= 0) NOT VALID,
  ADD CONSTRAINT privacy_deletion_receipts_storage_bytes_check
    CHECK (storage_bytes >= 0) NOT VALID;

-- Receipts deliberately do not FK to the ephemeral worker job. The proof must remain durable
-- even if operational job history is later compacted.
CREATE UNIQUE INDEX IF NOT EXISTS privacy_deletion_receipts_job_uq
  ON privacy_deletion_receipts(organization_id, deletion_job_id)
  WHERE deletion_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS privacy_deletion_receipts_completed_idx
  ON privacy_deletion_receipts(organization_id, completed_at DESC);

CREATE OR REPLACE FUNCTION sync_privacy_deletion_receipt_legacy_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.subject_digest := COALESCE(NEW.subject_digest, NEW.candidate_reference_hash);
  NEW.candidate_reference_hash := COALESCE(NEW.candidate_reference_hash, NEW.subject_digest);

  IF NEW.deleted_counts = '{}'::jsonb AND NEW.deletion_summary <> '{}'::jsonb THEN
    NEW.deleted_counts := NEW.deletion_summary;
  ELSIF NEW.deletion_summary = '{}'::jsonb AND NEW.deleted_counts <> '{}'::jsonb THEN
    NEW.deletion_summary := NEW.deleted_counts;
  END IF;

  IF NEW.requested_at IS NULL THEN
    SELECT request.requested_at
    INTO NEW.requested_at
    FROM privacy_requests request
    WHERE request.organization_id = NEW.organization_id
      AND request.id = NEW.privacy_request_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS privacy_deletion_receipt_legacy_sync ON privacy_deletion_receipts;
CREATE TRIGGER privacy_deletion_receipt_legacy_sync
BEFORE INSERT OR UPDATE ON privacy_deletion_receipts
FOR EACH ROW EXECUTE FUNCTION sync_privacy_deletion_receipt_legacy_columns();

-- A storage key can have duplicate metadata rows. Once a deletion job succeeds, remove every
-- unreferenced file row for objects that were verified absent, not only the representative file_id.
CREATE OR REPLACE FUNCTION cleanup_privacy_deletion_file_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state = 'succeeded' AND OLD.state IS DISTINCT FROM 'succeeded' THEN
    DELETE FROM files file
    USING privacy_deletion_objects object
    WHERE object.organization_id = NEW.organization_id
      AND object.deletion_job_id = NEW.id
      AND object.state = 'deleted'
      AND file.organization_id = object.organization_id
      AND file.storage_key = object.storage_key
      AND NOT EXISTS (
        SELECT 1 FROM resumes resume
        WHERE resume.organization_id = file.organization_id AND resume.file_id = file.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM interview_recordings recording
        WHERE recording.organization_id = file.organization_id AND recording.file_id = file.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM assessment_submissions submission
        WHERE submission.organization_id = file.organization_id AND submission.artifact_file_id = file.id
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS privacy_deletion_file_metadata_cleanup ON privacy_deletion_jobs;
CREATE TRIGGER privacy_deletion_file_metadata_cleanup
AFTER UPDATE OF state ON privacy_deletion_jobs
FOR EACH ROW EXECUTE FUNCTION cleanup_privacy_deletion_file_metadata();

COMMENT ON TABLE privacy_deletion_jobs IS
  'Durable lease/retry control plane for approved privacy erasure requests.';
COMMENT ON TABLE privacy_deletion_objects IS
  'External storage objects planned for erasure; success requires delete plus provider absence verification.';
