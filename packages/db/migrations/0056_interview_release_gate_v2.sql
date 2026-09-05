ALTER TABLE interview_release_units
  ADD COLUMN IF NOT EXISTS rubric_version varchar(120),
  ADD COLUMN IF NOT EXISTS prompt_version_family varchar(160),
  ADD COLUMN IF NOT EXISTS validation_dataset_version varchar(160),
  ADD COLUMN IF NOT EXISTS calibration_report_reference varchar(1024),
  ADD COLUMN IF NOT EXISTS security_review_reference varchar(1024),
  ADD COLUMN IF NOT EXISTS privacy_compliance_review_reference varchar(1024),
  ADD COLUMN IF NOT EXISTS known_limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rollback_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS suspension_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approval_status varchar(32) NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS material_fingerprint varchar(64),
  ADD COLUMN IF NOT EXISTS approved_material_fingerprint varchar(64),
  ADD COLUMN IF NOT EXISTS suspended_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspension_reason text;

ALTER TABLE interview_release_units DROP CONSTRAINT IF EXISTS interview_release_units_approval_status_check;
ALTER TABLE interview_release_units ADD CONSTRAINT interview_release_units_approval_status_check CHECK (
  approval_status IN ('draft', 'pending', 'approved', 'revalidation_required', 'expired', 'suspended')
);
ALTER TABLE interview_release_units DROP CONSTRAINT IF EXISTS interview_release_units_approval_expiry_check;
ALTER TABLE interview_release_units ADD CONSTRAINT interview_release_units_approval_expiry_check CHECK (
  approval_expires_at IS NULL OR approved_at IS NULL OR approval_expires_at > approved_at
);
ALTER TABLE interview_release_units DROP CONSTRAINT IF EXISTS interview_release_units_material_fingerprint_check;
ALTER TABLE interview_release_units ADD CONSTRAINT interview_release_units_material_fingerprint_check CHECK (
  (material_fingerprint IS NULL OR material_fingerprint ~ '^[0-9a-f]{64}$')
  AND (approved_material_fingerprint IS NULL OR approved_material_fingerprint ~ '^[0-9a-f]{64}$')
);

UPDATE interview_release_units
SET approval_status = 'revalidation_required'
WHERE lifecycle_stage IN ('CONTROLLED_PRODUCTION', 'SCALED_PRODUCTION')
  AND production_approved_at IS NOT NULL
  AND approval_status = 'draft';
UPDATE interview_release_units SET approval_status = 'suspended' WHERE lifecycle_stage = 'SUSPENDED';

CREATE TABLE IF NOT EXISTS interview_release_approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  release_unit_id uuid NOT NULL,
  event_type varchar(40) NOT NULL CHECK (event_type IN ('submitted', 'approved', 'revalidation_required', 'expired', 'suspended', 'resumed')),
  previous_status varchar(32),
  new_status varchar(32) NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  artifact_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, release_unit_id) REFERENCES interview_release_units(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS interview_release_approval_events_unit_idx ON interview_release_approval_events(organization_id, release_unit_id, created_at DESC);

CREATE OR REPLACE FUNCTION invalidate_interview_release_approval_on_material_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.lifecycle_stage IS DISTINCT FROM NEW.lifecycle_stage
     OR OLD.job_family IS DISTINCT FROM NEW.job_family
     OR OLD.language IS DISTINCT FROM NEW.language
     OR OLD.interview_type IS DISTINCT FROM NEW.interview_type
     OR OLD.rubric_version_family IS DISTINCT FROM NEW.rubric_version_family
     OR OLD.rubric_version IS DISTINCT FROM NEW.rubric_version
     OR OLD.interviewer_policy_version IS DISTINCT FROM NEW.interviewer_policy_version
     OR OLD.prompt_version_family IS DISTINCT FROM NEW.prompt_version_family
     OR OLD.evaluator_version IS DISTINCT FROM NEW.evaluator_version
     OR OLD.speech_avatar_stack_version IS DISTINCT FROM NEW.speech_avatar_stack_version
     OR OLD.validation_dataset_version IS DISTINCT FROM NEW.validation_dataset_version THEN
    IF OLD.approval_status = 'approved' THEN NEW.approval_status := 'revalidation_required'; END IF;
    NEW.material_fingerprint := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS interview_release_material_change_guard ON interview_release_units;
CREATE TRIGGER interview_release_material_change_guard BEFORE UPDATE ON interview_release_units
FOR EACH ROW EXECUTE FUNCTION invalidate_interview_release_approval_on_material_change();

CREATE OR REPLACE FUNCTION audit_interview_release_approval_status_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_name varchar(40); actor_id uuid;
BEGIN
  IF OLD.approval_status IS NOT DISTINCT FROM NEW.approval_status THEN RETURN NEW; END IF;
  event_name := CASE NEW.approval_status
    WHEN 'approved' THEN 'approved' WHEN 'revalidation_required' THEN 'revalidation_required'
    WHEN 'expired' THEN 'expired' WHEN 'suspended' THEN 'suspended'
    WHEN 'pending' THEN 'submitted' ELSE 'resumed' END;
  actor_id := COALESCE(NEW.suspended_by_user_id, NEW.approved_by_user_id);
  INSERT INTO interview_release_approval_events (
    organization_id, release_unit_id, event_type, previous_status, new_status, actor_user_id, reason, artifact_snapshot
  ) VALUES (
    NEW.organization_id, NEW.id, event_name, OLD.approval_status, NEW.approval_status, actor_id, NEW.suspension_reason,
    jsonb_build_object(
      'jobFamily', NEW.job_family, 'language', NEW.language, 'interviewType', NEW.interview_type,
      'rubricVersionFamily', NEW.rubric_version_family, 'rubricVersion', NEW.rubric_version,
      'interviewerPolicyVersion', NEW.interviewer_policy_version, 'promptVersionFamily', NEW.prompt_version_family,
      'evaluatorVersion', NEW.evaluator_version, 'speechStackVersion', NEW.speech_avatar_stack_version,
      'validationDatasetVersion', NEW.validation_dataset_version, 'materialFingerprint', NEW.material_fingerprint,
      'approvalExpiresAt', NEW.approval_expires_at
    )
  );
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS interview_release_approval_status_audit ON interview_release_units;
CREATE TRIGGER interview_release_approval_status_audit AFTER UPDATE OF approval_status ON interview_release_units
FOR EACH ROW EXECUTE FUNCTION audit_interview_release_approval_status_change();

CREATE OR REPLACE FUNCTION protect_interview_release_approval_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Release approval audit events are immutable'; END $$;
DROP TRIGGER IF EXISTS interview_release_approval_events_immutable ON interview_release_approval_events;
CREATE TRIGGER interview_release_approval_events_immutable BEFORE UPDATE OR DELETE ON interview_release_approval_events
FOR EACH ROW EXECUTE FUNCTION protect_interview_release_approval_event();

CREATE INDEX IF NOT EXISTS interview_release_units_approval_idx ON interview_release_units(organization_id, approval_status, approval_expires_at);
