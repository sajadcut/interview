ALTER TABLE ai_jobs
  ADD COLUMN IF NOT EXISTS capability_version varchar(80) NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS prompt_id varchar(80),
  ADD COLUMN IF NOT EXISTS prompt_version varchar(80),
  ADD COLUMN IF NOT EXISTS input_references jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS structured_output_schema_version varchar(80),
  ADD COLUMN IF NOT EXISTS provider_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS usage jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE ai_jobs
  DROP CONSTRAINT IF EXISTS ai_jobs_prompt_reference_pair_check;
ALTER TABLE ai_jobs
  ADD CONSTRAINT ai_jobs_prompt_reference_pair_check CHECK (
    (prompt_id IS NULL AND prompt_version IS NULL)
    OR (prompt_id IS NOT NULL AND prompt_version IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION hydrate_ai_job_capability_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF jsonb_typeof(NEW.payload) = 'object' THEN
    NEW.capability_version := COALESCE(NULLIF(NEW.payload->>'capabilityVersion', ''), NEW.capability_version);
    NEW.prompt_id := COALESCE(NULLIF(NEW.payload->>'promptId', ''), NEW.prompt_id);
    NEW.prompt_version := COALESCE(NULLIF(NEW.payload->>'promptVersion', ''), NEW.prompt_version);
    NEW.structured_output_schema_version := COALESCE(
      NULLIF(NEW.payload->>'structuredOutputSchemaVersion', ''),
      NEW.structured_output_schema_version
    );
    IF jsonb_typeof(NEW.payload->'inputReferences') = 'object' THEN
      NEW.input_references := NEW.payload->'inputReferences';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ai_jobs_capability_provenance_hydrate ON ai_jobs;
CREATE TRIGGER ai_jobs_capability_provenance_hydrate
BEFORE INSERT OR UPDATE OF payload ON ai_jobs
FOR EACH ROW
EXECUTE FUNCTION hydrate_ai_job_capability_provenance();

CREATE OR REPLACE FUNCTION capture_ai_job_result_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  provenance jsonb;
BEGIN
  IF NEW.result IS NULL OR jsonb_typeof(NEW.result) <> 'object' THEN
    RETURN NEW;
  END IF;
  provenance := NEW.result->'provenance';
  IF provenance IS NOT NULL AND jsonb_typeof(provenance) = 'object' THEN
    NEW.provider_provenance := provenance - 'usage' - 'inputReferences';
    IF jsonb_typeof(provenance->'usage') = 'object' THEN
      NEW.usage := provenance->'usage';
    END IF;
    NEW.prompt_id := COALESCE(NULLIF(provenance->>'promptId', ''), NEW.prompt_id);
    NEW.prompt_version := COALESCE(NULLIF(provenance->>'promptVersion', ''), NEW.prompt_version);
  END IF;
  NEW.structured_output_schema_version := COALESCE(
    NULLIF(NEW.result->>'structuredOutputSchemaVersion', ''),
    NEW.structured_output_schema_version
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ai_jobs_result_provenance_capture ON ai_jobs;
CREATE TRIGGER ai_jobs_result_provenance_capture
BEFORE UPDATE OF result ON ai_jobs
FOR EACH ROW
EXECUTE FUNCTION capture_ai_job_result_provenance();

CREATE INDEX IF NOT EXISTS ai_jobs_capability_status_idx
  ON ai_jobs(organization_id, capability, capability_version, status, created_at DESC);

ALTER TABLE ai_executions
  ADD COLUMN IF NOT EXISTS capability_version varchar(80) NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS prompt_id varchar(80),
  ADD COLUMN IF NOT EXISTS structured_output_schema_version varchar(80),
  ADD COLUMN IF NOT EXISTS cost_micros bigint,
  ADD COLUMN IF NOT EXISTS attempts jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE ai_executions
  DROP CONSTRAINT IF EXISTS ai_executions_cost_micros_check;
ALTER TABLE ai_executions
  ADD CONSTRAINT ai_executions_cost_micros_check CHECK (cost_micros IS NULL OR cost_micros >= 0);
