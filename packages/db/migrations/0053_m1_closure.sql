-- M1 closure: pin every application to an immutable rubric version and preserve
-- deterministic scorecard inputs so historical decisions remain reconstructable.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS rubric_version_id uuid;

-- Preserve the rubric version that existing applications most likely used. Prefer
-- an already persisted scorecard, then an evaluation, then the current published
-- (or latest draft as a final legacy fallback) rubric for the job.
UPDATE applications a
SET rubric_version_id = COALESCE(
  (
    SELECT s.rubric_version_id
    FROM scorecards s
    WHERE s.organization_id = a.organization_id
      AND s.application_id = a.id
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT 1
  ),
  (
    SELECT e.rubric_version_id
    FROM candidate_criterion_evaluations e
    WHERE e.organization_id = a.organization_id
      AND e.application_id = a.id
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1
  ),
  (
    SELECT rv.id
    FROM rubrics r
    JOIN rubric_versions rv
      ON rv.organization_id = r.organization_id
     AND rv.rubric_id = r.id
    WHERE r.organization_id = a.organization_id
      AND r.job_id = a.job_id
    ORDER BY CASE WHEN rv.status = 'published' THEN 0 ELSE 1 END, rv.version DESC
    LIMIT 1
  )
)
WHERE a.rubric_version_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM applications WHERE rubric_version_id IS NULL) THEN
    RAISE EXCEPTION 'M1 closure requires every existing application to resolve to a rubric version';
  END IF;
END;
$$;

ALTER TABLE applications
  ALTER COLUMN rubric_version_id SET NOT NULL;

ALTER TABLE applications
  ADD CONSTRAINT applications_org_rubric_version_fk
  FOREIGN KEY (organization_id, rubric_version_id)
  REFERENCES rubric_versions(organization_id, id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS applications_org_rubric_version_idx
  ON applications(organization_id, rubric_version_id);

CREATE OR REPLACE FUNCTION pin_application_rubric_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.rubric_version_id IS NULL THEN
    SELECT rv.id
      INTO NEW.rubric_version_id
    FROM rubrics r
    JOIN rubric_versions rv
      ON rv.organization_id = r.organization_id
     AND rv.rubric_id = r.id
    WHERE r.organization_id = NEW.organization_id
      AND r.job_id = NEW.job_id
    ORDER BY CASE WHEN rv.status = 'published' THEN 0 ELSE 1 END, rv.version DESC
    LIMIT 1;
  END IF;

  IF NEW.rubric_version_id IS NULL THEN
    RAISE EXCEPTION 'Application requires a rubric version'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM rubric_versions rv
    JOIN rubrics r
      ON r.organization_id = rv.organization_id
     AND r.id = rv.rubric_id
    WHERE rv.organization_id = NEW.organization_id
      AND rv.id = NEW.rubric_version_id
      AND r.job_id = NEW.job_id
  ) THEN
    RAISE EXCEPTION 'Application rubric version must belong to the application job'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applications_pin_rubric_version ON applications;
CREATE TRIGGER applications_pin_rubric_version
BEFORE INSERT OR UPDATE OF job_id, rubric_version_id ON applications
FOR EACH ROW
EXECUTE FUNCTION pin_application_rubric_version();

CREATE OR REPLACE FUNCTION enforce_evaluation_application_rubric()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM applications a
    JOIN rubric_criteria rc
      ON rc.organization_id = a.organization_id
     AND rc.rubric_version_id = a.rubric_version_id
    WHERE a.organization_id = NEW.organization_id
      AND a.id = NEW.application_id
      AND a.rubric_version_id = NEW.rubric_version_id
      AND rc.id = NEW.criterion_id
  ) THEN
    RAISE EXCEPTION 'Evaluation rubric/criterion must match the application pinned rubric version'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS criterion_evaluation_application_rubric_guard ON candidate_criterion_evaluations;
CREATE TRIGGER criterion_evaluation_application_rubric_guard
BEFORE INSERT OR UPDATE OF application_id, rubric_version_id, criterion_id
ON candidate_criterion_evaluations
FOR EACH ROW
EXECUTE FUNCTION enforce_evaluation_application_rubric();

ALTER TABLE scorecards
  ADD COLUMN IF NOT EXISTS input_fingerprint varchar(32);

CREATE UNIQUE INDEX IF NOT EXISTS criterion_evaluations_org_id_uq
  ON candidate_criterion_evaluations(organization_id, id);

CREATE TABLE IF NOT EXISTS scorecard_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scorecard_id uuid NOT NULL,
  criterion_evaluation_id uuid NOT NULL,
  criterion_id uuid NOT NULL,
  weight numeric(6,3) NOT NULL CHECK (weight > 0),
  score numeric(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (scorecard_id, criterion_id),
  FOREIGN KEY (organization_id, scorecard_id)
    REFERENCES scorecards(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, criterion_evaluation_id)
    REFERENCES candidate_criterion_evaluations(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, criterion_id)
    REFERENCES rubric_criteria(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS scorecard_inputs_org_scorecard_idx
  ON scorecard_inputs(organization_id, scorecard_id);

-- Reconstruct legacy scorecards using the last evaluation that existed at the
-- moment the scorecard was created. The old finalizer used exactly this rule.
INSERT INTO scorecard_inputs (
  organization_id,
  scorecard_id,
  criterion_evaluation_id,
  criterion_id,
  weight,
  score,
  evidence_ids,
  created_at
)
SELECT
  s.organization_id,
  s.id,
  latest.id,
  rc.id,
  rc.weight,
  latest.score,
  latest.evidence_ids,
  s.created_at
FROM scorecards s
JOIN rubric_criteria rc
  ON rc.organization_id = s.organization_id
 AND rc.rubric_version_id = s.rubric_version_id
 AND rc.required = true
JOIN LATERAL (
  SELECT e.id, e.score, e.evidence_ids
  FROM candidate_criterion_evaluations e
  WHERE e.organization_id = s.organization_id
    AND e.application_id = s.application_id
    AND e.rubric_version_id = s.rubric_version_id
    AND e.criterion_id = rc.id
    AND e.created_at <= s.created_at
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT 1
) latest ON true
ON CONFLICT (scorecard_id, criterion_id) DO NOTHING;

UPDATE scorecards s
SET input_fingerprint = fingerprints.fingerprint
FROM (
  SELECT
    si.organization_id,
    si.scorecard_id,
    md5(string_agg(
      concat_ws('|',
        si.criterion_id::text,
        si.criterion_evaluation_id::text,
        si.weight::text,
        si.score::text,
        array_to_string(si.evidence_ids, ',')
      ),
      ';' ORDER BY si.criterion_id
    )) AS fingerprint
  FROM scorecard_inputs si
  GROUP BY si.organization_id, si.scorecard_id
) fingerprints
WHERE s.organization_id = fingerprints.organization_id
  AND s.id = fingerprints.scorecard_id
  AND s.input_fingerprint IS NULL;

ALTER TABLE scorecards
  ADD CONSTRAINT scorecards_idempotency_uniq
  UNIQUE (organization_id, application_id, rubric_version_id, algorithm_version, input_fingerprint);

CREATE OR REPLACE FUNCTION prepare_scorecard_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_rubric_version uuid;
  snapshot_payload text;
BEGIN
  SELECT a.rubric_version_id
    INTO expected_rubric_version
  FROM applications a
  WHERE a.organization_id = NEW.organization_id
    AND a.id = NEW.application_id;

  IF expected_rubric_version IS NULL OR expected_rubric_version <> NEW.rubric_version_id THEN
    RAISE EXCEPTION 'Scorecard rubric version must match the application pinned rubric version'
      USING ERRCODE = '23514';
  END IF;

  SELECT string_agg(
    concat_ws('|',
      rc.id::text,
      latest.id::text,
      rc.weight::text,
      latest.score::text,
      array_to_string(latest.evidence_ids, ',')
    ),
    ';' ORDER BY rc.display_order, rc.id
  )
  INTO snapshot_payload
  FROM rubric_criteria rc
  JOIN LATERAL (
    SELECT e.id, e.score, e.evidence_ids
    FROM candidate_criterion_evaluations e
    WHERE e.organization_id = NEW.organization_id
      AND e.application_id = NEW.application_id
      AND e.rubric_version_id = NEW.rubric_version_id
      AND e.criterion_id = rc.id
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1
  ) latest ON true
  WHERE rc.organization_id = NEW.organization_id
    AND rc.rubric_version_id = NEW.rubric_version_id
    AND rc.required = true;

  IF snapshot_payload IS NULL THEN
    RAISE EXCEPTION 'Scorecard requires evaluated required criteria'
      USING ERRCODE = '23514';
  END IF;

  NEW.input_fingerprint := md5(snapshot_payload);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION persist_scorecard_snapshot_inputs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO scorecard_inputs (
    organization_id,
    scorecard_id,
    criterion_evaluation_id,
    criterion_id,
    weight,
    score,
    evidence_ids
  )
  SELECT
    NEW.organization_id,
    NEW.id,
    latest.id,
    rc.id,
    rc.weight,
    latest.score,
    latest.evidence_ids
  FROM rubric_criteria rc
  JOIN LATERAL (
    SELECT e.id, e.score, e.evidence_ids
    FROM candidate_criterion_evaluations e
    WHERE e.organization_id = NEW.organization_id
      AND e.application_id = NEW.application_id
      AND e.rubric_version_id = NEW.rubric_version_id
      AND e.criterion_id = rc.id
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1
  ) latest ON true
  WHERE rc.organization_id = NEW.organization_id
    AND rc.rubric_version_id = NEW.rubric_version_id
    AND rc.required = true
  ON CONFLICT (scorecard_id, criterion_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scorecards_prepare_snapshot ON scorecards;
CREATE TRIGGER scorecards_prepare_snapshot
BEFORE INSERT OR UPDATE OF application_id, rubric_version_id
ON scorecards
FOR EACH ROW
EXECUTE FUNCTION prepare_scorecard_snapshot();

DROP TRIGGER IF EXISTS scorecards_persist_snapshot_inputs ON scorecards;
CREATE TRIGGER scorecards_persist_snapshot_inputs
AFTER INSERT ON scorecards
FOR EACH ROW
EXECUTE FUNCTION persist_scorecard_snapshot_inputs();
