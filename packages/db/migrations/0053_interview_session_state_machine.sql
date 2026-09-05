ALTER TABLE interview_sessions
  ADD COLUMN IF NOT EXISTS state_version integer NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  ADD COLUMN IF NOT EXISTS resume_status varchar(40),
  ADD COLUMN IF NOT EXISTS recovery_attempt_count integer NOT NULL DEFAULT 0 CHECK (recovery_attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS last_transition_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS disconnected_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_code varchar(120),
  ADD COLUMN IF NOT EXISTS failure_recoverable boolean,
  ADD COLUMN IF NOT EXISTS last_failure_at timestamptz;

ALTER TABLE interview_sessions
  DROP CONSTRAINT IF EXISTS interview_sessions_resume_status_check;
ALTER TABLE interview_sessions
  ADD CONSTRAINT interview_sessions_resume_status_check CHECK (
    resume_status IS NULL OR resume_status IN ('in_progress', 'paused')
  );

CREATE TABLE IF NOT EXISTS interview_session_state_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_session_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  idempotency_key varchar(200) NOT NULL,
  request_fingerprint varchar(64) NOT NULL,
  action varchar(40) NOT NULL CHECK (
    action IN ('start', 'pause', 'resume', 'disconnect', 'reconnect', 'finish', 'fail', 'recover', 'cancel')
  ),
  from_status varchar(40) NOT NULL CHECK (
    from_status IN ('invited', 'in_progress', 'paused', 'disconnected', 'completed', 'failed', 'cancelled')
  ),
  to_status varchar(40) NOT NULL CHECK (
    to_status IN ('invited', 'in_progress', 'paused', 'disconnected', 'completed', 'failed', 'cancelled')
  ),
  state_version integer NOT NULL CHECK (state_version > 0),
  reconnect_count integer NOT NULL CHECK (reconnect_count >= 0),
  recovery_attempt_count integer NOT NULL CHECK (recovery_attempt_count >= 0),
  resume_status varchar(40) CHECK (resume_status IS NULL OR resume_status IN ('in_progress', 'paused')),
  failure_code varchar(120),
  failure_recoverable boolean,
  reason varchar(500),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (interview_session_id, sequence),
  UNIQUE (interview_session_id, idempotency_key),
  FOREIGN KEY (organization_id, interview_session_id)
    REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS interview_session_state_events_session_idx
  ON interview_session_state_events(organization_id, interview_session_id, occurred_at DESC);

COMMENT ON TABLE interview_session_state_events IS
  'Append-only canonical interview lifecycle journal. Stores no raw media, transcript text, credentials, or model output.';
COMMENT ON COLUMN interview_sessions.state_version IS
  'Optimistic concurrency version for canonical interview-session lifecycle transitions.';
COMMENT ON COLUMN interview_sessions.resume_status IS
  'Stable state restored after a disconnected session reconnects or recovers.';
