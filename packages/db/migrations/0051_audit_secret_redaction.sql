CREATE OR REPLACE FUNCTION audit_redact_jsonb_secrets(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  entry record;
  canonical_key text;
  result jsonb;
BEGIN
  IF jsonb_typeof(input) = 'object' THEN
    result := '{}'::jsonb;
    FOR entry IN SELECT key, value FROM jsonb_each(input)
    LOOP
      canonical_key := regexp_replace(lower(entry.key), '[^a-z0-9]', '', 'g');
      IF canonical_key IN (
        'authorization',
        'cookie',
        'credential',
        'credentials',
        'password',
        'passphrase',
        'otp',
        'apikey',
        'privatekey',
        'secretaccesskey'
      )
      OR canonical_key ~ '(password|passphrase|secret|token|tokenhash|otphash|apikey|privatekey|accesskey)$'
      OR canonical_key ~ '^(authorization|cookie|credential)'
      THEN
        result := result || jsonb_build_object(entry.key, '[REDACTED]');
      ELSE
        result := result || jsonb_build_object(entry.key, audit_redact_jsonb_secrets(entry.value));
      END IF;
    END LOOP;
    RETURN result;
  END IF;

  IF jsonb_typeof(input) = 'array' THEN
    SELECT COALESCE(jsonb_agg(audit_redact_jsonb_secrets(value)), '[]'::jsonb)
    INTO result
    FROM jsonb_array_elements(input);
    RETURN result;
  END IF;

  RETURN input;
END;
$$;

CREATE OR REPLACE FUNCTION audit_events_redact_secrets_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."before" IS NOT NULL THEN
    NEW."before" := audit_redact_jsonb_secrets(NEW."before");
  END IF;
  IF NEW."after" IS NOT NULL THEN
    NEW."after" := audit_redact_jsonb_secrets(NEW."after");
  END IF;
  IF NEW.metadata IS NOT NULL THEN
    NEW.metadata := audit_redact_jsonb_secrets(NEW.metadata);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_events_redact_secrets ON audit_events;
CREATE TRIGGER audit_events_redact_secrets
BEFORE INSERT OR UPDATE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION audit_events_redact_secrets_trigger();
