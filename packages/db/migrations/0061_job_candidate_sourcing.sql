-- Job-first candidate sourcing is an HR/Recruiter workflow.
-- Grant HR managers the bounded sourcing.run permission while preserving
-- integration administration as an organization-admin responsibility.

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'sourcing.run'
WHERE r.key = 'HR_MANAGER'
ON CONFLICT (role_id, permission_id) DO NOTHING;
