CREATE TABLE interviewer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email varchar(320) NOT NULL,
  first_name varchar(120) NOT NULL,
  last_name varchar(120) NOT NULL DEFAULT '',
  phone varchar(80),
  job_title varchar(200),
  specialties text[] NOT NULL DEFAULT ARRAY[]::text[],
  bio text,
  status varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interviewer_profiles_status_ck CHECK (status IN ('active', 'disabled'))
);

CREATE UNIQUE INDEX interviewer_profiles_org_email_uq
  ON interviewer_profiles (organization_id, lower(email));

CREATE INDEX interviewer_profiles_org_status_idx
  ON interviewer_profiles (organization_id, status, updated_at DESC);

INSERT INTO interviewer_profiles (
  organization_id,
  email,
  first_name,
  last_name,
  job_title,
  specialties,
  status
)
SELECT DISTINCT
  m.organization_id,
  u.email,
  COALESCE(NULLIF(split_part(COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)), ' ', 1), ''), split_part(u.email, '@', 1)),
  CASE
    WHEN position(' ' in COALESCE(u.display_name, '')) > 0
      THEN trim(substr(u.display_name, position(' ' in u.display_name) + 1))
    ELSE ''
  END,
  'مصاحبه‌گر',
  ARRAY[]::text[],
  CASE WHEN m.status = 'active' AND u.disabled_at IS NULL THEN 'active' ELSE 'disabled' END
FROM memberships m
JOIN users u ON u.id = m.user_id
JOIN membership_roles mr
  ON mr.organization_id = m.organization_id
 AND mr.membership_id = m.id
JOIN roles r
  ON r.organization_id = m.organization_id
 AND r.id = mr.role_id
WHERE r.key = 'INTERVIEWER'
ON CONFLICT DO NOTHING;
