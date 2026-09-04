-- Automatic, durable retention execution and privacy deletion FK hardening.

-- Composite SET NULL actions must never null tenant ownership.
ALTER TABLE privacy_requests
  DROP CONSTRAINT IF EXISTS privacy_requests_candidate_fk;
ALTER TABLE privacy_requests
  ADD CONSTRAINT privacy_requests_candidate_fk
  FOREIGN KEY (organization_id, candidate_id)
  REFERENCES candidates(organization_id, id)
  ON DELETE SET NULL (candidate_id);

ALTER TABLE privacy_deletion_jobs
  DROP CONSTRAINT IF EXISTS privacy_deletion_jobs_organization_id_candidate_id_fkey;
ALTER TABLE privacy_deletion_jobs
  DROP CONSTRAINT IF EXISTS privacy_deletion_jobs_candidate_fk;
ALTER TABLE privacy_deletion_jobs
  ADD CONSTRAINT privacy_deletion_jobs_candidate_fk
  FOREIGN KEY (organization_id, candidate_id)
  REFERENCES candidates(organization_id, id)
  ON DELETE SET NULL (candidate_id);

ALTER TABLE privacy_deletion_objects
  DROP CONSTRAINT IF EXISTS privacy_deletion_objects_organization_id_file_id_fkey;
ALTER TABLE privacy_deletion_objects
  DROP CONSTRAINT IF EXISTS privacy_deletion_objects_file_fk;
ALTER TABLE privacy_deletion_objects
  ADD CONSTRAINT privacy_deletion_objects_file_fk
  FOREIGN KEY (organization_id, file_id)
  REFERENCES files(organization_id, id)
  ON DELETE SET NULL (file_id);

ALTER TABLE ai_jobs
  DROP CONSTRAINT IF EXISTS ai_jobs_organization_id_execution_id_fkey;
ALTER TABLE ai_jobs
  DROP CONSTRAINT IF EXISTS ai_jobs_execution_fk;
ALTER TABLE ai_jobs
  ADD CONSTRAINT ai_jobs_execution_fk
  FOREIGN KEY (organization_id, execution_id)
  REFERENCES ai_executions(organization_id, id)
  ON DELETE SET NULL (execution_id);

CREATE TABLE IF NOT EXISTS retention_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cycle_key varchar(120) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'claimed', 'retry_scheduled', 'succeeded', 'failed')),
  dry_run boolean NOT NULL DEFAULT true,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  worker_id varchar(160),
  lease_token uuid,
  lease_expires_at timestamptz,
  policy_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error_code varchar(120),
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, cycle_key)
);

CREATE INDEX IF NOT EXISTS retention_jobs_claim_idx
  ON retention_jobs(state, available_at, created_at)
  WHERE state IN ('queued', 'retry_scheduled');
CREATE INDEX IF NOT EXISTS retention_jobs_lease_idx
  ON retention_jobs(lease_expires_at)
  WHERE state = 'claimed';
CREATE INDEX IF NOT EXISTS retention_jobs_org_created_idx
  ON retention_jobs(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS retention_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  retention_job_id uuid NOT NULL,
  entity_type varchar(80) NOT NULL,
  cutoff_at timestamptz NOT NULL,
  status varchar(32) NOT NULL CHECK (
    status IN ('preview', 'executed', 'held', 'unsupported_fail_closed')
  ),
  eligible_count integer NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  deleted_count integer NOT NULL DEFAULT 0 CHECK (deleted_count >= 0),
  held_count integer NOT NULL DEFAULT 0 CHECK (held_count >= 0),
  delegated_count integer NOT NULL DEFAULT 0 CHECK (delegated_count >= 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, retention_job_id, entity_type),
  FOREIGN KEY (organization_id, retention_job_id)
    REFERENCES retention_jobs(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS retention_job_items_job_idx
  ON retention_job_items(organization_id, retention_job_id, entity_type);

CREATE TABLE IF NOT EXISTS retention_candidate_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  retention_job_id uuid NOT NULL,
  candidate_id uuid,
  privacy_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, retention_job_id, candidate_id),
  FOREIGN KEY (organization_id, retention_job_id)
    REFERENCES retention_jobs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, candidate_id)
    REFERENCES candidates(organization_id, id) ON DELETE SET NULL (candidate_id),
  FOREIGN KEY (organization_id, privacy_request_id)
    REFERENCES privacy_requests(organization_id, id) ON DELETE SET NULL (privacy_request_id)
);
CREATE INDEX IF NOT EXISTS retention_candidate_deletions_request_idx
  ON retention_candidate_deletions(organization_id, privacy_request_id)
  WHERE privacy_request_id IS NOT NULL;

COMMENT ON TABLE retention_jobs IS
  'Durable automatic retention cycles with lease/retry semantics and immutable policy snapshots.';
COMMENT ON TABLE retention_job_items IS
  'Per-policy retention execution evidence including held, deleted and delegated counts.';
COMMENT ON TABLE retention_candidate_deletions IS
  'Idempotent bridge from candidate retention to the verified privacy deletion worker.';

CREATE OR REPLACE FUNCTION retention_candidate_is_inactive(
  p_organization_id uuid,
  p_candidate_id uuid,
  p_cutoff timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM candidates candidate
    WHERE candidate.organization_id = p_organization_id
      AND candidate.id = p_candidate_id
      AND candidate.created_at < p_cutoff
  )
  AND NOT EXISTS (
    SELECT 1 FROM applications application
    WHERE application.organization_id = p_organization_id
      AND application.candidate_id = p_candidate_id
      AND (
        application.updated_at >= p_cutoff
        OR application.status NOT IN ('rejected', 'withdrawn', 'hired', 'closed', 'archived')
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM resumes resume
    WHERE resume.organization_id = p_organization_id
      AND resume.candidate_id = p_candidate_id
      AND (resume.created_at >= p_cutoff OR resume.updated_at >= p_cutoff)
  )
  AND NOT EXISTS (
    SELECT 1 FROM evidence evidence_row
    WHERE evidence_row.organization_id = p_organization_id
      AND evidence_row.candidate_id = p_candidate_id
      AND evidence_row.created_at >= p_cutoff
  )
  AND NOT EXISTS (
    SELECT 1 FROM conversations conversation
    WHERE conversation.organization_id = p_organization_id
      AND conversation.candidate_id = p_candidate_id
      AND (conversation.created_at >= p_cutoff OR conversation.updated_at >= p_cutoff)
  )
  AND NOT EXISTS (
    SELECT 1 FROM recruitment_events event
    WHERE event.organization_id = p_organization_id
      AND event.candidate_id = p_candidate_id
      AND event.occurred_at >= p_cutoff
  )
  AND NOT EXISTS (
    SELECT 1
    FROM interview_sessions session
    JOIN applications application
      ON application.organization_id = session.organization_id
     AND application.id = session.application_id
    WHERE session.organization_id = p_organization_id
      AND application.candidate_id = p_candidate_id
      AND (session.created_at >= p_cutoff OR session.updated_at >= p_cutoff)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM assessment_sessions session
    JOIN applications application
      ON application.organization_id = session.organization_id
     AND application.id = session.application_id
    WHERE session.organization_id = p_organization_id
      AND application.candidate_id = p_candidate_id
      AND (session.created_at >= p_cutoff OR session.updated_at >= p_cutoff)
  )
  AND NOT EXISTS (
    SELECT 1 FROM privacy_requests request
    WHERE request.organization_id = p_organization_id
      AND request.candidate_id = p_candidate_id
      AND (
        request.requested_at >= p_cutoff
        OR request.status IN (
          'pending_review',
          'approved_pending_execution',
          'execution_in_progress',
          'deletion_blocked'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION retention_candidate_is_held(
  p_organization_id uuid,
  p_candidate_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM legal_holds hold
    WHERE hold.organization_id = p_organization_id
      AND hold.status = 'active'
      AND (
        hold.candidate_id = p_candidate_id
        OR (hold.entity_type = 'candidate' AND hold.entity_id = p_candidate_id)
        OR (
          hold.entity_type = 'application'
          AND hold.entity_id IN (
            SELECT application.id FROM applications application
            WHERE application.organization_id = p_organization_id
              AND application.candidate_id = p_candidate_id
          )
        )
        OR (
          hold.entity_type = 'resume'
          AND hold.entity_id IN (
            SELECT resume.id FROM resumes resume
            WHERE resume.organization_id = p_organization_id
              AND resume.candidate_id = p_candidate_id
          )
        )
        OR (
          hold.entity_type = 'interview_session'
          AND hold.entity_id IN (
            SELECT session.id
            FROM interview_sessions session
            JOIN applications application
              ON application.organization_id = session.organization_id
             AND application.id = session.application_id
            WHERE session.organization_id = p_organization_id
              AND application.candidate_id = p_candidate_id
          )
        )
        OR (
          hold.entity_type = 'assessment_session'
          AND hold.entity_id IN (
            SELECT session.id
            FROM assessment_sessions session
            JOIN applications application
              ON application.organization_id = session.organization_id
             AND application.id = session.application_id
            WHERE session.organization_id = p_organization_id
              AND application.candidate_id = p_candidate_id
          )
        )
      )
  );
$$;

COMMENT ON FUNCTION retention_candidate_is_inactive(uuid, uuid, timestamptz) IS
  'Fail-closed candidate inactivity predicate used by automatic retention.';
COMMENT ON FUNCTION retention_candidate_is_held(uuid, uuid) IS
  'Canonical legal-hold predicate for candidate retention eligibility.';
