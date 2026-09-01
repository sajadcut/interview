INSERT INTO permissions (key, description) VALUES
  ('organization.manage_users', 'Invite, assign, disable, reactivate and remove organization users'),
  ('settings.manage', 'Manage organization settings')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

WITH role_definitions(role_key, role_name) AS (
  VALUES
    ('PLATFORM_ADMIN', 'Platform Admin'),
    ('ORGANIZATION_ADMIN', 'Organization Admin'),
    ('RECRUITER', 'Recruiter'),
    ('INTERVIEWER', 'Interviewer'),
    ('HIRING_MANAGER', 'Hiring Manager')
)
INSERT INTO roles (organization_id, key, name)
SELECT o.id, rd.role_key, rd.role_name
FROM organizations o
CROSS JOIN role_definitions rd
ON CONFLICT (organization_id, key) DO UPDATE SET name = EXCLUDED.name;

WITH role_permission_map(role_key, permission_key) AS (
  VALUES
    ('PLATFORM_ADMIN', '*'),

    ('ORGANIZATION_ADMIN', 'organization.read'),
    ('ORGANIZATION_ADMIN', 'organization.manage'),
    ('ORGANIZATION_ADMIN', 'organization.manage_users'),
    ('ORGANIZATION_ADMIN', 'settings.manage'),
    ('ORGANIZATION_ADMIN', 'job.read'),
    ('ORGANIZATION_ADMIN', 'job.create'),
    ('ORGANIZATION_ADMIN', 'job.edit'),
    ('ORGANIZATION_ADMIN', 'candidate.read'),
    ('ORGANIZATION_ADMIN', 'candidate.contact'),
    ('ORGANIZATION_ADMIN', 'candidate.move_stage'),
    ('ORGANIZATION_ADMIN', 'candidate.score'),
    ('ORGANIZATION_ADMIN', 'sourcing.run'),
    ('ORGANIZATION_ADMIN', 'talent.manage'),
    ('ORGANIZATION_ADMIN', 'screening.manage'),
    ('ORGANIZATION_ADMIN', 'scheduling.manage'),
    ('ORGANIZATION_ADMIN', 'knowledge.manage'),
    ('ORGANIZATION_ADMIN', 'interview.read'),
    ('ORGANIZATION_ADMIN', 'interview.manage'),
    ('ORGANIZATION_ADMIN', 'interview.evaluate'),
    ('ORGANIZATION_ADMIN', 'assessment.read'),
    ('ORGANIZATION_ADMIN', 'assessment.manage'),
    ('ORGANIZATION_ADMIN', 'analytics.read'),
    ('ORGANIZATION_ADMIN', 'privacy.manage'),
    ('ORGANIZATION_ADMIN', 'decision.submit'),
    ('ORGANIZATION_ADMIN', 'integration.manage'),
    ('ORGANIZATION_ADMIN', 'audit.read'),

    ('RECRUITER', 'job.read'),
    ('RECRUITER', 'job.create'),
    ('RECRUITER', 'job.edit'),
    ('RECRUITER', 'candidate.read'),
    ('RECRUITER', 'candidate.contact'),
    ('RECRUITER', 'candidate.move_stage'),
    ('RECRUITER', 'candidate.score'),
    ('RECRUITER', 'sourcing.run'),
    ('RECRUITER', 'talent.manage'),
    ('RECRUITER', 'screening.manage'),
    ('RECRUITER', 'scheduling.manage'),
    ('RECRUITER', 'knowledge.manage'),
    ('RECRUITER', 'interview.read'),
    ('RECRUITER', 'interview.manage'),
    ('RECRUITER', 'assessment.read'),
    ('RECRUITER', 'assessment.manage'),

    ('INTERVIEWER', 'candidate.read'),
    ('INTERVIEWER', 'candidate.score'),
    ('INTERVIEWER', 'interview.read'),
    ('INTERVIEWER', 'interview.manage'),
    ('INTERVIEWER', 'interview.evaluate'),
    ('INTERVIEWER', 'assessment.read'),

    ('HIRING_MANAGER', 'organization.read'),
    ('HIRING_MANAGER', 'job.read'),
    ('HIRING_MANAGER', 'candidate.read'),
    ('HIRING_MANAGER', 'candidate.score'),
    ('HIRING_MANAGER', 'interview.read'),
    ('HIRING_MANAGER', 'interview.evaluate'),
    ('HIRING_MANAGER', 'assessment.read'),
    ('HIRING_MANAGER', 'analytics.read'),
    ('HIRING_MANAGER', 'decision.submit')
), expanded AS (
  SELECT rpm.role_key, p.key AS permission_key
  FROM role_permission_map rpm
  JOIN permissions p ON rpm.permission_key = '*' OR p.key = rpm.permission_key
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN expanded e ON e.role_key = r.key
JOIN permissions p ON p.key = e.permission_key
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Existing development org_admin roles remain supported; ensure they receive the two new permissions.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key IN ('organization.manage_users', 'settings.manage')
WHERE r.key = 'org_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;
