-- Canonical HR Manager role. This role owns policy/oversight/reporting capabilities
-- without inheriting organization-user or integration administration.
WITH role_definitions(role_key, role_name) AS (
  VALUES ('HR_MANAGER', 'HR Manager')
)
INSERT INTO roles (organization_id, key, name)
SELECT o.id, rd.role_key, rd.role_name
FROM organizations o
CROSS JOIN role_definitions rd
ON CONFLICT (organization_id, key) DO UPDATE SET name = EXCLUDED.name;

WITH hr_permissions(permission_key) AS (
  VALUES
    ('organization.read'),
    ('settings.manage'),
    ('job.read'),
    ('job.edit'),
    ('candidate.read'),
    ('candidate.contact'),
    ('candidate.move_stage'),
    ('candidate.score'),
    ('talent.manage'),
    ('screening.manage'),
    ('scheduling.manage'),
    ('knowledge.manage'),
    ('interview.read'),
    ('interview.assign'),
    ('interview.evaluate'),
    ('assessment.read'),
    ('analytics.read'),
    ('privacy.manage'),
    ('decision.submit'),
    ('audit.read')
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN hr_permissions hp ON true
JOIN permissions p ON p.key = hp.permission_key
WHERE r.key = 'HR_MANAGER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Preserve least privilege if an earlier/manual role with the same key existed.
DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.key = 'HR_MANAGER'
  AND p.key IN ('organization.manage', 'organization.manage_users', 'integration.manage', 'job.create');
