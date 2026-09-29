-- Hiring requisition workflow: requesting team -> HR recruiting -> technical approval.
-- Candidate remains organization-global; Application remains the job-specific lifecycle owner.

INSERT INTO permissions (key, description) VALUES
  ('hiring_request.read', 'Read hiring requisitions and workflow state'),
  ('hiring_request.create', 'Create and submit hiring requisitions'),
  ('hiring_request.manage', 'Review, approve, reject and link hiring requisitions to jobs'),
  ('technical_approval.submit', 'Submit requesting-team technical approval for an application')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS hiring_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title varchar(240) NOT NULL,
  hiring_team varchar(160) NOT NULL,
  department varchar(160),
  headcount integer NOT NULL DEFAULT 1 CHECK (headcount BETWEEN 1 AND 100),
  seniority varchar(80),
  location varchar(240),
  employment_type varchar(80),
  business_reason text NOT NULL CHECK (char_length(trim(business_reason)) >= 3),
  requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(40) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','rejected','recruiting','filled','cancelled')),
  requester_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  hr_owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  linked_job_id uuid,
  review_note text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, linked_job_id),
  FOREIGN KEY (organization_id, linked_job_id)
    REFERENCES jobs(organization_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS hiring_requests_org_status_idx
  ON hiring_requests(organization_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS hiring_requests_requester_idx
  ON hiring_requests(organization_id, requester_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS application_technical_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  hiring_request_id uuid NOT NULL,
  application_id uuid NOT NULL,
  approver_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision varchar(32) NOT NULL CHECK (decision IN ('approve','needs_interview','reject')),
  feedback text NOT NULL CHECK (char_length(trim(feedback)) BETWEEN 3 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, hiring_request_id)
    REFERENCES hiring_requests(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, application_id)
    REFERENCES applications(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS application_technical_approvals_application_idx
  ON application_technical_approvals(organization_id, application_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_technical_approval_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM hiring_requests hr
    JOIN applications a
      ON a.organization_id = hr.organization_id AND a.job_id = hr.linked_job_id
    WHERE hr.organization_id = NEW.organization_id
      AND hr.id = NEW.hiring_request_id
      AND a.id = NEW.application_id
  ) THEN
    RAISE EXCEPTION 'Technical approval application must belong to the hiring request linked job'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS application_technical_approval_scope_guard ON application_technical_approvals;
CREATE TRIGGER application_technical_approval_scope_guard
BEFORE INSERT OR UPDATE OF hiring_request_id, application_id
ON application_technical_approvals
FOR EACH ROW EXECUTE FUNCTION enforce_technical_approval_scope();

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.key IN ('hiring_request.read','hiring_request.create','hiring_request.manage','technical_approval.submit')
WHERE r.key IN ('ORGANIZATION_ADMIN','org_admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.key IN ('hiring_request.read','hiring_request.manage','job.create')
WHERE r.key = 'HR_MANAGER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.key IN ('hiring_request.read','hiring_request.manage')
WHERE r.key = 'RECRUITER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.key IN ('hiring_request.read','hiring_request.create','technical_approval.submit')
WHERE r.key = 'HIRING_MANAGER'
ON CONFLICT (role_id, permission_id) DO NOTHING;
