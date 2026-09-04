-- Make the privacy deletion receipt idempotency target directly usable by PostgreSQL ON CONFLICT.
-- UNIQUE constraints permit multiple NULL deletion_job_id values, so legacy receipts without a
-- worker job remain valid while worker-backed receipts stay unique per organization/job.

DROP INDEX IF EXISTS privacy_deletion_receipts_job_uq;

ALTER TABLE privacy_deletion_receipts
  DROP CONSTRAINT IF EXISTS privacy_deletion_receipts_job_uq;

ALTER TABLE privacy_deletion_receipts
  ADD CONSTRAINT privacy_deletion_receipts_job_uq
  UNIQUE (organization_id, deletion_job_id);
