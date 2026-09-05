CREATE TABLE IF NOT EXISTS interview_review_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  interview_session_id uuid NOT NULL, evaluation_id uuid, scorecard_id uuid,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb, priority integer NOT NULL DEFAULT 100 CHECK (priority >= 0 AND priority <= 1000),
  status varchar(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'completed')),
  review_owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL, reviewer_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  evidence_references jsonb NOT NULL DEFAULT '[]'::jsonb, criterion_comparison jsonb NOT NULL DEFAULT '[]'::jsonb,
  sampling_context jsonb NOT NULL DEFAULT '{}'::jsonb, candidate_complaint_reference varchar(1024),
  human_override jsonb NOT NULL DEFAULT '{}'::jsonb, override_rationale text,
  claimed_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, interview_session_id) REFERENCES interview_sessions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, evaluation_id) REFERENCES interview_evaluations(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, scorecard_id) REFERENCES scorecards(organization_id, id) ON DELETE SET NULL,
  CHECK (status <> 'completed' OR (reviewer_user_id IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK (jsonb_typeof(reason_codes) = 'array'), CHECK (jsonb_typeof(evidence_references) = 'array'), CHECK (jsonb_typeof(criterion_comparison) = 'array')
);
CREATE UNIQUE INDEX IF NOT EXISTS interview_review_tasks_evaluation_uq ON interview_review_tasks(organization_id, evaluation_id) WHERE evaluation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS interview_review_tasks_queue_idx ON interview_review_tasks(organization_id, status, priority, created_at);
CREATE INDEX IF NOT EXISTS interview_review_tasks_owner_idx ON interview_review_tasks(organization_id, review_owner_user_id, status, created_at);

CREATE TABLE IF NOT EXISTS interview_review_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  review_task_id uuid NOT NULL, event_type varchar(32) NOT NULL CHECK (event_type IN ('created','claimed','completed')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id), FOREIGN KEY (organization_id, review_task_id) REFERENCES interview_review_tasks(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS interview_review_task_events_task_idx ON interview_review_task_events(organization_id, review_task_id, created_at);

CREATE OR REPLACE FUNCTION enqueue_interview_evaluation_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reasons jsonb; refs jsonb;
BEGIN
  IF NEW.requires_human_review IS DISTINCT FROM true THEN RETURN NEW; END IF;
  reasons := NEW.output_snapshot->'reviewReasons';
  IF reasons IS NULL OR jsonb_typeof(reasons) <> 'array' OR jsonb_array_length(reasons) = 0 THEN reasons := '["evaluation_requires_human_review"]'::jsonb; END IF;
  refs := NEW.input_references->'evidenceIds';
  IF refs IS NULL OR jsonb_typeof(refs) <> 'array' THEN refs := '[]'::jsonb; END IF;
  INSERT INTO interview_review_tasks(
    organization_id, interview_session_id, evaluation_id, scorecard_id, reason_codes, priority,
    evidence_references, criterion_comparison, sampling_context
  ) VALUES (
    NEW.organization_id, NEW.interview_session_id, NEW.id, NEW.scorecard_id, reasons,
    CASE WHEN NEW.status IN ('low_confidence','insufficient_evidence') THEN 50 ELSE 100 END,
    refs, COALESCE(NEW.criterion_results, '[]'::jsonb),
    jsonb_build_object('provider', NEW.provider, 'model', NEW.model, 'promptVersion', NEW.prompt_version, 'evaluatorVersion', NEW.evaluator_version)
  ) ON CONFLICT (organization_id, evaluation_id) WHERE evaluation_id IS NOT NULL DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS interview_evaluation_review_enqueue ON interview_evaluations;
CREATE TRIGGER interview_evaluation_review_enqueue AFTER INSERT ON interview_evaluations FOR EACH ROW EXECUTE FUNCTION enqueue_interview_evaluation_review();

CREATE OR REPLACE FUNCTION audit_interview_review_task() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_name varchar(32); actor_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO interview_review_task_events(organization_id, review_task_id, event_type, actor_user_id, snapshot)
    VALUES (NEW.organization_id, NEW.id, 'created', NULL, jsonb_build_object('status', NEW.status, 'reasonCodes', NEW.reason_codes));
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status AND OLD.review_owner_user_id IS NOT DISTINCT FROM NEW.review_owner_user_id THEN RETURN NEW; END IF;
  event_name := CASE WHEN NEW.status = 'completed' AND OLD.status <> 'completed' THEN 'completed' ELSE 'claimed' END;
  actor_id := COALESCE(NEW.reviewer_user_id, NEW.review_owner_user_id);
  INSERT INTO interview_review_task_events(organization_id, review_task_id, event_type, actor_user_id, snapshot)
  VALUES (NEW.organization_id, NEW.id, event_name, actor_id,
    jsonb_build_object('status', NEW.status, 'reasonCodes', NEW.reason_codes, 'humanOverride', NEW.human_override, 'overrideRationale', NEW.override_rationale));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS interview_review_tasks_audit ON interview_review_tasks;
CREATE TRIGGER interview_review_tasks_audit AFTER INSERT OR UPDATE ON interview_review_tasks FOR EACH ROW EXECUTE FUNCTION audit_interview_review_task();

CREATE OR REPLACE FUNCTION protect_completed_interview_review_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.status = 'completed' THEN RAISE EXCEPTION 'Completed interview review tasks are immutable'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS interview_review_tasks_completed_immutable ON interview_review_tasks;
CREATE TRIGGER interview_review_tasks_completed_immutable BEFORE UPDATE OR DELETE ON interview_review_tasks FOR EACH ROW WHEN (OLD.status = 'completed') EXECUTE FUNCTION protect_completed_interview_review_task();
CREATE OR REPLACE FUNCTION protect_interview_review_task_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Interview review audit events are immutable'; END $$;
DROP TRIGGER IF EXISTS interview_review_task_events_immutable ON interview_review_task_events;
CREATE TRIGGER interview_review_task_events_immutable BEFORE UPDATE OR DELETE ON interview_review_task_events FOR EACH ROW EXECUTE FUNCTION protect_interview_review_task_event();
