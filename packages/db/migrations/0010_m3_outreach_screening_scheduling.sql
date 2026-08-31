INSERT INTO permissions (key, description) VALUES
  ('screening.manage', 'Configure and review structured candidate screening'),
  ('scheduling.manage', 'Manage candidate interview scheduling'),
  ('knowledge.manage', 'Manage approved recruiting knowledge used in candidate communication')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS knowledge_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id uuid,
  knowledge_type varchar(48) NOT NULL,
  title varchar(240) NOT NULL,
  body text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'draft',
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, job_id) REFERENCES jobs(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS knowledge_items_scope_idx ON knowledge_items(organization_id, job_id, status);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  application_id uuid,
  channel varchar(48) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'open',
  provider_reference varchar(512),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidates(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, application_id) REFERENCES applications(organization_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS conversations_candidate_idx ON conversations(organization_id, candidate_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  direction varchar(16) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender_type varchar(24) NOT NULL CHECK (sender_type IN ('candidate', 'human', 'ai')),
  body text NOT NULL,
  grounding_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_state varchar(32) NOT NULL DEFAULT 'not_required',
  provider_reference varchar(512),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES conversations(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(organization_id, conversation_id, created_at);

CREATE TABLE IF NOT EXISTS screening_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  rules_version varchar(80) NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  hard_filter_result jsonb,
  recommendation varchar(48),
  review_state varchar(32) NOT NULL DEFAULT 'pending_human_review',
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, application_id) REFERENCES applications(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS screening_application_idx ON screening_sessions(organization_id, application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS scheduling_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  interview_type varchar(80) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'collecting_availability',
  timezone varchar(80) NOT NULL,
  proposed_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_start timestamptz,
  selected_end timestamptz,
  calendar_provider varchar(64),
  calendar_reference varchar(512),
  reminder_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, application_id) REFERENCES applications(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS scheduling_application_idx ON scheduling_requests(organization_id, application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recruitment_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_id uuid,
  application_id uuid,
  notification_type varchar(64) NOT NULL,
  channel varchar(48) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  scheduled_for timestamptz,
  sent_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, candidate_id) REFERENCES candidates(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, application_id) REFERENCES applications(organization_id, id) ON DELETE CASCADE
);
