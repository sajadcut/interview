-- Production auth/candidate-token rate-limit hardening.
--
-- The limiter uses the existing PostgreSQL primary key (scope, key_hash) as the
-- serialization point, so it remains correct across API processes without Redis.
-- This index supports bounded operational cleanup/inspection of stale buckets.
CREATE INDEX IF NOT EXISTS auth_rate_limits_updated_idx
  ON auth_rate_limits(updated_at);

COMMENT ON TABLE auth_rate_limits IS
  'Hashed, multi-process authentication abuse-control buckets. Raw emails, IP identifiers and tokens are never stored.';
COMMENT ON COLUMN auth_rate_limits.key_hash IS
  'SHA-256 of the normalized/exact rate-limit identifier; never the raw credential or token.';
COMMENT ON COLUMN auth_rate_limits.blocked_until IS
  'Absolute server-side block expiry used to produce deterministic Retry-After responses.';
