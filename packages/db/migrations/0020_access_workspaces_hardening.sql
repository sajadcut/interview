CREATE TABLE IF NOT EXISTS platform_user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_key varchar(80) NOT NULL CHECK (role_key = 'PLATFORM_ADMIN'),
  granted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (user_id, role_key)
);
CREATE INDEX IF NOT EXISTS platform_user_roles_active_idx
  ON platform_user_roles(user_id) WHERE revoked_at IS NULL;

-- PLATFORM_ADMIN is a platform-global role. Any legacy tenant-scoped assignment is
-- downgraded to ORGANIZATION_ADMIN instead of being promoted globally.
DO $$
DECLARE
  assignment record;
  org_admin_role_id uuid;
BEGIN
  FOR assignment IN
    SELECT mr.membership_id, mr.organization_id, mr.role_id
    FROM membership_roles mr
    JOIN roles r ON r.id = mr.role_id AND r.organization_id = mr.organization_id
    WHERE r.key = 'PLATFORM_ADMIN'
  LOOP
    INSERT INTO roles (organization_id, key, name)
    VALUES (assignment.organization_id, 'ORGANIZATION_ADMIN', 'Organization Admin')
    ON CONFLICT (organization_id, key) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO org_admin_role_id;

    INSERT INTO membership_roles (organization_id, membership_id, role_id)
    VALUES (assignment.organization_id, assignment.membership_id, org_admin_role_id)
    ON CONFLICT (membership_id, role_id) DO UPDATE
      SET organization_id = EXCLUDED.organization_id;

    DELETE FROM membership_roles
    WHERE membership_id = assignment.membership_id
      AND role_id = assignment.role_id;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS interview_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_session_id uuid NOT NULL,
  interviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status varchar(32) NOT NULL DEFAULT 'assigned' CHECK (
    status IN ('assigned', 'accepted', 'declined', 'completed', 'cancelled')
  ),
  scheduled_for timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, interview_session_id, interviewer_user_id),
  FOREIGN KEY (organization_id, interview_session_id)
    REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS interview_assignments_interviewer_idx
  ON interview_assignments(organization_id, interviewer_user_id, scheduled_for, created_at DESC);

CREATE TABLE IF NOT EXISTS interview_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_session_id uuid NOT NULL,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 10000),
  visibility varchar(24) NOT NULL DEFAULT 'internal' CHECK (visibility = 'internal'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, interview_session_id)
    REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS interview_notes_session_idx
  ON interview_notes(organization_id, interview_session_id, created_at DESC);
