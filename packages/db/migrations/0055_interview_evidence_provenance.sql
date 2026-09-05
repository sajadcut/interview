CREATE UNIQUE INDEX IF NOT EXISTS interview_turns_org_session_id_uq
  ON interview_turns(organization_id, interview_session_id, id);

ALTER TABLE interview_evidence
  ADD COLUMN IF NOT EXISTS source_kind varchar(24) NOT NULL DEFAULT 'unanchored';

ALTER TABLE interview_evidence
  DROP CONSTRAINT IF EXISTS interview_evidence_source_kind_check;
ALTER TABLE interview_evidence
  ADD CONSTRAINT interview_evidence_source_kind_check CHECK (
    source_kind IN ('candidate', 'interviewer', 'system', 'mixed', 'unanchored')
  );

ALTER TABLE interview_evidence
  DROP CONSTRAINT IF EXISTS interview_evidence_has_transcript_anchor_check;
ALTER TABLE interview_evidence
  ADD CONSTRAINT interview_evidence_has_transcript_anchor_check
  CHECK (cardinality(transcript_segment_ids) > 0) NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interview_evidence_turn_session_fk'
  ) THEN
    ALTER TABLE interview_evidence
      ADD CONSTRAINT interview_evidence_turn_session_fk
      FOREIGN KEY (organization_id, interview_session_id, turn_id)
      REFERENCES interview_turns(organization_id, interview_session_id, id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION validate_interview_evidence_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  segment_count integer;
  final_segment_count integer;
  speaker_count integer;
  only_speaker varchar(24);
BEGIN
  IF cardinality(NEW.transcript_segment_ids) = 0 THEN
    RAISE EXCEPTION 'Interview evidence requires at least one transcript anchor';
  END IF;

  IF cardinality(NEW.transcript_segment_ids) <> (
    SELECT count(*) FROM (SELECT DISTINCT unnest(NEW.transcript_segment_ids)) AS distinct_segments
  ) THEN
    RAISE EXCEPTION 'Interview evidence transcript anchors must be unique';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE is_final = true)
  INTO segment_count, final_segment_count
  FROM interview_transcript_segments
  WHERE organization_id = NEW.organization_id
    AND interview_session_id = NEW.interview_session_id
    AND id = ANY(NEW.transcript_segment_ids);

  IF segment_count <> cardinality(NEW.transcript_segment_ids) THEN
    RAISE EXCEPTION 'Interview evidence references a transcript outside its tenant/session';
  END IF;
  IF final_segment_count <> segment_count THEN
    RAISE EXCEPTION 'Interview evidence may only anchor finalized transcript segments';
  END IF;

  IF NEW.turn_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM interview_turns
    WHERE organization_id = NEW.organization_id
      AND interview_session_id = NEW.interview_session_id
      AND id = NEW.turn_id
  ) THEN
    RAISE EXCEPTION 'Interview evidence turn must belong to the same tenant/session';
  END IF;

  IF NEW.criterion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM interview_sessions s
    JOIN interview_plans p
      ON p.organization_id = s.organization_id AND p.id = s.interview_plan_id
    JOIN rubric_criteria rc
      ON rc.organization_id = p.organization_id
     AND rc.rubric_version_id = p.rubric_version_id
     AND rc.id = NEW.criterion_id
    WHERE s.organization_id = NEW.organization_id
      AND s.id = NEW.interview_session_id
  ) THEN
    RAISE EXCEPTION 'Interview evidence criterion must belong to the plan rubric version';
  END IF;

  SELECT count(DISTINCT speaker), min(speaker)
  INTO speaker_count, only_speaker
  FROM interview_transcript_segments
  WHERE organization_id = NEW.organization_id
    AND interview_session_id = NEW.interview_session_id
    AND id = ANY(NEW.transcript_segment_ids);

  NEW.source_kind := CASE WHEN speaker_count = 1 THEN only_speaker ELSE 'mixed' END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS interview_evidence_provenance_guard ON interview_evidence;
CREATE TRIGGER interview_evidence_provenance_guard
BEFORE INSERT OR UPDATE OF organization_id, interview_session_id, criterion_id, turn_id, transcript_segment_ids
ON interview_evidence
FOR EACH ROW
EXECUTE FUNCTION validate_interview_evidence_provenance();

UPDATE interview_evidence e
SET source_kind = source_summary.source_kind
FROM (
  SELECT
    e2.id,
    CASE
      WHEN cardinality(e2.transcript_segment_ids) = 0 THEN 'unanchored'
      WHEN count(DISTINCT t.speaker) = 1 THEN min(t.speaker)
      WHEN count(t.id) = 0 THEN 'unanchored'
      ELSE 'mixed'
    END AS source_kind
  FROM interview_evidence e2
  LEFT JOIN interview_transcript_segments t
    ON t.organization_id = e2.organization_id
   AND t.interview_session_id = e2.interview_session_id
   AND t.id = ANY(e2.transcript_segment_ids)
  GROUP BY e2.id, e2.transcript_segment_ids
) source_summary
WHERE source_summary.id = e.id;

CREATE INDEX IF NOT EXISTS interview_evidence_session_criterion_idx
  ON interview_evidence(organization_id, interview_session_id, criterion_id, created_at);
