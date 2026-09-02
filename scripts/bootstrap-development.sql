BEGIN;

INSERT INTO organizations (name, slug)
VALUES (:'org_name', :'org_slug')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now();

INSERT INTO users (email, display_name)
VALUES (:'user_email', :'user_name')
ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now();

INSERT INTO credentials (user_id, password_hash, failed_login_count, locked_until, reset_required, password_changed_at, updated_at)
SELECT u.id, :'password_hash', 0, NULL, false, now(), now()
FROM users u
WHERE u.email = :'user_email' AND :'password_hash' <> ''
ON CONFLICT (user_id) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  failed_login_count = 0,
  locked_until = NULL,
  reset_required = false,
  password_changed_at = now(),
  updated_at = now();

INSERT INTO memberships (organization_id, user_id, status)
SELECT o.id, u.id, 'active'
FROM organizations o, users u
WHERE o.slug = :'org_slug' AND u.email = :'user_email'
ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'active', updated_at = now();

INSERT INTO roles (organization_id, key, name)
SELECT id, 'org_admin', 'Organization Admin'
FROM organizations
WHERE slug = :'org_slug'
ON CONFLICT (organization_id, key) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO membership_roles (organization_id, membership_id, role_id)
SELECT m.organization_id, m.id, r.id
FROM memberships m
JOIN organizations o ON o.id = m.organization_id
JOIN users u ON u.id = m.user_id
JOIN roles r ON r.organization_id = m.organization_id AND r.key = 'org_admin'
WHERE o.slug = :'org_slug' AND u.email = :'user_email'
ON CONFLICT (membership_id, role_id) DO UPDATE SET organization_id = EXCLUDED.organization_id;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN organizations o ON o.id = r.organization_id
CROSS JOIN permissions p
WHERE o.slug = :'org_slug' AND r.key = 'org_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

SELECT
  o.id AS x_organization_id,
  u.id AS x_user_id,
  m.id AS membership_id
FROM organizations o
JOIN memberships m ON m.organization_id = o.id
JOIN users u ON u.id = m.user_id
WHERE o.slug = :'org_slug' AND u.email = :'user_email';

COMMIT;
