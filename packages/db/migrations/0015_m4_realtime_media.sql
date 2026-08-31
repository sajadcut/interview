CREATE TABLE IF NOT EXISTS interview_media_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_session_id uuid NOT NULL,
  mode varchar(24) NOT NULL CHECK (mode IN ('audio', 'avatar')),
  status varchar(32) NOT NULL DEFAULT 'created' CHECK (
    status IN ('created', 'preflight', 'connecting', 'connected', 'degraded', 'ended', 'failed')
  ),
  transport_provider varchar(80) NOT NULL,
  room_reference varchar(240),
  pipeline_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  recording_state varchar(32) NOT NULL DEFAULT 'disabled' CHECK (
    recording_state IN ('disabled', 'not_requested', 'recording', 'stopped', 'failed')
  ),
  last_error text,
  last_heartbeat_at timestamptz,
  connected_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, interview_session_id)
    REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS interview_media_sessions_interview_idx
  ON interview_media_sessions(organization_id, interview_session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS interview_media_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  media_session_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  event_type varchar(48) NOT NULL CHECK (
    event_type IN (
      'preflight', 'provider_status', 'connecting', 'connected', 'degraded',
      'disconnected', 'reconnected', 'vad_speech_start', 'vad_speech_end',
      'stt_final', 'brain_turn', 'tts_started', 'tts_ended',
      'avatar_started', 'avatar_ended', 'heartbeat', 'ended', 'error'
    )
  ),
  source_component varchar(24) CHECK (
    source_component IS NULL OR source_component IN ('transport', 'vad', 'stt', 'brain', 'tts', 'avatar', 'api')
  ),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (media_session_id, sequence),
  FOREIGN KEY (organization_id, media_session_id)
    REFERENCES interview_media_sessions(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS interview_media_events_session_idx
  ON interview_media_events(organization_id, media_session_id, sequence);

COMMENT ON TABLE interview_media_sessions IS
  'Realtime interview media lifecycle metadata. Provider credentials, access tokens and raw media are intentionally not persisted here.';

COMMENT ON TABLE interview_media_events IS
  'Operational realtime media event journal. Candidate transcript/evidence remain in dedicated interview tables.';
