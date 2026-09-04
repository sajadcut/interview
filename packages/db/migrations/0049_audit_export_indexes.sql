-- Operational indexes for complete organization-scoped audit exports.

CREATE INDEX IF NOT EXISTS application_stage_transitions_org_created_idx
  ON application_stage_transitions(organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS hiring_decisions_org_created_idx
  ON hiring_decisions(organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS criterion_evaluations_org_created_idx
  ON candidate_criterion_evaluations(organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS scorecards_org_created_idx
  ON scorecards(organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS score_overrides_org_created_idx
  ON score_overrides(organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS automation_runs_org_created_idx
  ON automation_runs(organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS candidate_consent_receipts_org_created_idx
  ON candidate_consent_receipts(organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS privacy_requests_org_requested_idx
  ON privacy_requests(organization_id, requested_at DESC, id DESC);

COMMENT ON INDEX application_stage_transitions_org_created_idx IS
  'Supports organization-wide chronological audit export without application fan-out scans.';
COMMENT ON INDEX hiring_decisions_org_created_idx IS
  'Supports complete chronological hiring-decision audit export.';
COMMENT ON INDEX criterion_evaluations_org_created_idx IS
  'Supports complete chronological evaluator provenance export.';
