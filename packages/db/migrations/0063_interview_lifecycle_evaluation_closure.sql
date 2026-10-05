CREATE TABLE IF NOT EXISTS interview_integrity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_session_id uuid NOT NULL,
  media_session_id uuid,
  sequence integer NOT NULL CHECK (sequence >= 0),
  event_type varchar(48) NOT NULL CHECK (
    event_type IN (
      'visibility_hidden',
      'visibility_visible',
      'window_blur',
      'window_focus',
      'large_paste',
      'reconnect'
    )
  ),
  client_occurred_at timestamptz,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (interview_session_id, sequence),
  FOREIGN KEY (organization_id, interview_session_id)
    REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, media_session_id)
    REFERENCES interview_media_sessions(organization_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS interview_integrity_events_session_idx
  ON interview_integrity_events(organization_id, interview_session_id, created_at);

COMMENT ON TABLE interview_integrity_events IS
  'Observable candidate-session integrity signals only. Events are decision-support evidence for human review and must never be treated as proof of cheating or used for automatic rejection.';
COMMENT ON COLUMN interview_integrity_events.metadata IS
  'Bounded metadata only. Pasted text, clipboard contents, raw media, biometrics and inferred mental/personality traits are prohibited.';


ALTER TABLE interview_session_state_events
  DROP CONSTRAINT IF EXISTS interview_session_state_events_from_status_check;
ALTER TABLE interview_session_state_events
  DROP CONSTRAINT IF EXISTS interview_session_state_events_to_status_check;
ALTER TABLE interview_session_state_events
  ADD CONSTRAINT interview_session_state_events_from_status_check CHECK (
    from_status IN ('invited', 'scheduled', 'in_progress', 'paused', 'disconnected', 'completed', 'failed', 'cancelled')
  );
ALTER TABLE interview_session_state_events
  ADD CONSTRAINT interview_session_state_events_to_status_check CHECK (
    to_status IN ('invited', 'scheduled', 'in_progress', 'paused', 'disconnected', 'completed', 'failed', 'cancelled')
  );
