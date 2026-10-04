-- Complete HR-owned candidate intake for requisition-backed recruiting.
-- HR Manager already owns candidate lifecycle and scheduling; allow creating the
-- organization-global candidate record used before an Application is created.

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'candidate.resume_manage'
WHERE r.key = 'HR_MANAGER'
ON CONFLICT (role_id, permission_id) DO NOTHING;
