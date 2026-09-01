ALTER TABLE interview_media_events
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(200);

CREATE UNIQUE INDEX IF NOT EXISTS interview_media_events_idempotency_uq
  ON interview_media_events(organization_id, media_session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE interview_media_events
  DROP CONSTRAINT IF EXISTS interview_media_events_event_type_check;
ALTER TABLE interview_media_events
  ADD CONSTRAINT interview_media_events_event_type_check CHECK (
    event_type IN (
      'preflight', 'provider_status', 'connecting', 'connected', 'degraded',
      'disconnected', 'reconnected', 'participant_joined', 'participant_left',
      'turn_failure', 'vad_speech_start', 'vad_speech_end', 'stt_final',
      'brain_turn', 'tts_started', 'tts_ended', 'avatar_started',
      'avatar_ended', 'heartbeat', 'ended', 'error'
    )
  );

CREATE TABLE IF NOT EXISTS interview_media_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  media_session_id uuid NOT NULL,
  participant_key varchar(200) NOT NULL,
  participant_type varchar(24) NOT NULL CHECK (participant_type IN ('candidate', 'agent', 'supervisor', 'worker')),
  state varchar(24) NOT NULL DEFAULT 'joined' CHECK (state IN ('joined', 'left', 'disconnected')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  last_event_sequence integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, media_session_id, participant_key),
  FOREIGN KEY (organization_id, media_session_id)
    REFERENCES interview_media_sessions(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS interview_media_participants_session_idx
  ON interview_media_participants(organization_id, media_session_id, state, updated_at DESC);

COMMENT ON COLUMN interview_media_events.idempotency_key IS
  'Caller-generated stable key used to safely replay operational media events after retries/crashes.';
COMMENT ON TABLE interview_media_participants IS
  'Provider-neutral participant lifecycle state. Contains no access token, biometric inference, raw media or transcript text.';
