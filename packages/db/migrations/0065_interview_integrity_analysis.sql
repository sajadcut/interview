INSERT INTO permissions (key, description) VALUES
  ('interview.integrity_view', 'Read interview integrity assessments and observable signals'),
  ('interview.integrity_review', 'Review and resolve interview integrity concerns')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key IN ('interview.integrity_view', 'interview.integrity_review')
WHERE r.key IN ('PLATFORM_ADMIN', 'ORGANIZATION_ADMIN', 'org_admin', 'HR_MANAGER')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'interview.integrity_view'
WHERE r.key = 'INTERVIEWER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

ALTER TABLE interview_integrity_events
  ADD COLUMN IF NOT EXISTS server_occurred_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS source varchar(32) NOT NULL DEFAULT 'candidate_browser',
  ADD COLUMN IF NOT EXISTS severity varchar(24) NOT NULL DEFAULT 'informational',
  ADD COLUMN IF NOT EXISTS interpretation varchar(240) NOT NULL DEFAULT 'observable_signal_only';

ALTER TABLE interview_integrity_events
  DROP CONSTRAINT IF EXISTS interview_integrity_events_event_type_check,
  DROP CONSTRAINT IF EXISTS interview_integrity_events_source_check,
  DROP CONSTRAINT IF EXISTS interview_integrity_events_severity_check;

ALTER TABLE interview_integrity_events
  ADD CONSTRAINT interview_integrity_events_event_type_check CHECK (
    event_type IN (
      'visibility_hidden',
      'visibility_visible',
      'window_blur',
      'window_focus',
      'large_paste',
      'reconnect',
      'network_disconnect',
      'network_reconnect',
      'media_device_changed',
      'microphone_disabled',
      'microphone_enabled',
      'camera_disabled',
      'camera_enabled',
      'concurrent_session_detected',
      'unexpected_room_participant',
      'candidate_session_replaced',
      'answer_submission_spike',
      'repeated_large_paste'
    )
  ),
  ADD CONSTRAINT interview_integrity_events_source_check CHECK (
    source IN ('candidate_browser', 'livekit_client', 'server', 'analyzer')
  ),
  ADD CONSTRAINT interview_integrity_events_severity_check CHECK (
    severity IN ('none', 'informational', 'low', 'medium', 'high')
  );

CREATE INDEX IF NOT EXISTS interview_integrity_events_type_idx
  ON interview_integrity_events(organization_id, interview_session_id, event_type, server_occurred_at);

CREATE OR REPLACE FUNCTION protect_interview_integrity_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Interview integrity events are append-only';
END $$;
DROP TRIGGER IF EXISTS interview_integrity_events_immutable ON interview_integrity_events;
CREATE TRIGGER interview_integrity_events_immutable
  BEFORE UPDATE OR DELETE ON interview_integrity_events
  FOR EACH ROW EXECUTE FUNCTION protect_interview_integrity_event();

CREATE TABLE IF NOT EXISTS interview_integrity_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_session_id uuid NOT NULL,
  integrity_concern_score integer NOT NULL CHECK (integrity_concern_score BETWEEN 0 AND 100),
  risk_level varchar(16) NOT NULL CHECK (risk_level IN ('none', 'low', 'medium', 'high')),
  confidence varchar(16) NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  requires_human_review boolean NOT NULL DEFAULT false,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NOT NULL,
  analyzer_version varchar(80) NOT NULL,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, interview_session_id),
  FOREIGN KEY (organization_id, interview_session_id)
    REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(signals) = 'array')
);

CREATE INDEX IF NOT EXISTS interview_integrity_assessments_review_idx
  ON interview_integrity_assessments(organization_id, requires_human_review, risk_level, analyzed_at DESC);

CREATE TABLE IF NOT EXISTS interview_integrity_review_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_session_id uuid NOT NULL,
  integrity_assessment_id uuid NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending_review' CHECK (
    status IN ('pending_review', 'reviewed_no_concern', 'reviewed_concern', 'inconclusive')
  ),
  reviewer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  review_comment text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, interview_session_id),
  FOREIGN KEY (organization_id, interview_session_id)
    REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, integrity_assessment_id)
    REFERENCES interview_integrity_assessments(organization_id, id) ON DELETE CASCADE,
  CHECK (
    status = 'pending_review'
    OR (reviewer_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_comment IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS interview_integrity_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  review_case_id uuid NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  previous_status varchar(32),
  new_status varchar(32) NOT NULL,
  note text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, review_case_id)
    REFERENCES interview_integrity_review_cases(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS interview_integrity_review_events_case_idx
  ON interview_integrity_review_events(organization_id, review_case_id, created_at);

CREATE OR REPLACE FUNCTION protect_interview_integrity_review_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Interview integrity review events are append-only';
END $$;
DROP TRIGGER IF EXISTS interview_integrity_review_events_immutable ON interview_integrity_review_events;
CREATE TRIGGER interview_integrity_review_events_immutable
  BEFORE UPDATE OR DELETE ON interview_integrity_review_events
  FOR EACH ROW EXECUTE FUNCTION protect_interview_integrity_review_event();

CREATE TABLE IF NOT EXISTS interview_candidate_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_session_id uuid NOT NULL,
  media_session_id uuid,
  client_instance_hash varchar(64) NOT NULL,
  user_agent_family varchar(80),
  status varchar(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'replaced', 'disconnected')),
  replaced_by_client_hash varchar(64),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  replaced_at timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, interview_session_id, client_instance_hash),
  FOREIGN KEY (organization_id, interview_session_id)
    REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, media_session_id)
    REFERENCES interview_media_sessions(organization_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS interview_candidate_connections_active_idx
  ON interview_candidate_connections(organization_id, interview_session_id, status, last_seen_at DESC);

COMMENT ON TABLE interview_integrity_assessments IS
  'Deterministic decision-support analysis of observable integrity signals. The score is not a calibrated probability of cheating and must not affect technical scores or hiring recommendations automatically.';
COMMENT ON TABLE interview_integrity_review_cases IS
  'Human review workflow for medium/high integrity concerns. Status reviewed_concern means an integrity concern was confirmed, not that cheating was proven.';
COMMENT ON TABLE interview_candidate_connections IS
  'Privacy-bounded candidate browser connection registry. Stores a server hash of a random client instance identifier and coarse user-agent family; raw IP and browser fingerprinting are intentionally excluded.';
