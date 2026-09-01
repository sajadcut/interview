INSERT INTO permissions (key, description) VALUES
  ('interview.assign', 'Assign interviewers to interview sessions'),
  ('interview.start', 'Start an assigned interview session')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

-- Reconcile the existing canonical tenant roles with least-privilege interviewer access.
DO $$
DECLARE
  org record;
  role_id_value uuid;
  permission_key text;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    INSERT INTO roles (organization_id, key, name)
    VALUES (org.id, 'ORGANIZATION_ADMIN', 'Organization Admin')
    ON CONFLICT (organization_id, key) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO role_id_value;

    FOR permission_key IN SELECT key FROM permissions LOOP
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT role_id_value, id FROM permissions WHERE key = permission_key
      ON CONFLICT (role_id, permission_id) DO NOTHING;
    END LOOP;

    INSERT INTO roles (organization_id, key, name)
    VALUES (org.id, 'RECRUITER', 'Recruiter')
    ON CONFLICT (organization_id, key) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO role_id_value;

    INSERT INTO role_permissions (role_id, permission_id)
    SELECT role_id_value, id FROM permissions WHERE key IN ('interview.assign', 'interview.start')
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    INSERT INTO roles (organization_id, key, name)
    VALUES (org.id, 'INTERVIEWER', 'Interviewer')
    ON CONFLICT (organization_id, key) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO role_id_value;

    DELETE FROM role_permissions rp
    USING permissions p
    WHERE rp.role_id = role_id_value
      AND rp.permission_id = p.id
      AND p.key = 'interview.manage';

    INSERT INTO role_permissions (role_id, permission_id)
    SELECT role_id_value, id FROM permissions WHERE key = 'interview.start'
    ON CONFLICT (role_id, permission_id) DO NOTHING;
  END LOOP;
END $$;
