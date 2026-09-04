# Audit Export

The organization audit export is the governance snapshot for reconstructing high-impact system activity and decision provenance without relying on hidden model reasoning.

## Endpoint

`GET /v1/audit/export`

Requires tenant context and `audit.read`.

Optional filters:

- `from` / `to` — inclusive ISO-8601 time range.
- `action` — exact normalized action.
- `entityType` — exact normalized entity type.
- `limit` — explicit preview/backward-compatible cap. When omitted, the export is complete for the supported organization-scoped ledgers and `truncated=false`.

## Exported ledgers

The unified timeline currently covers:

- `audit_events` — explicit actor/action/entity audit records.
- `recruitment_events` — recruiting lifecycle activity.
- `application_stage_transitions` — application stage movement with reason/actor.
- `hiring_decisions` — human-controlled advance/hold/reject/hire/withdraw decisions.
- `candidate_criterion_evaluations` — human/AI criterion score provenance and evidence references.
- `scorecards` — deterministic score/recommendation output with rubric and algorithm version.
- `score_overrides` — human override before/after score and reason.
- `ai_executions` — provider/model/prompt version, status, structured output and token/latency provenance.
- `automation_runs` — automation input/output, approval and execution state.
- `candidate_consent_receipts` — versioned disclosure/AI interview/recording consent evidence.
- `privacy_requests` — privacy request/review lifecycle.
- `retention_jobs` and `retention_job_items` — automatic retention policy snapshots and execution evidence.

Every source query is constrained by `organization_id`; records from another tenant are never merged into the export.

## Normalized event shape

Every ledger is mapped to the existing audit event contract:

```json
{
  "id": "source-row-id",
  "actorType": "user|system|ai|human|candidate",
  "actorUserId": "uuid-or-null",
  "action": "normalized.action",
  "entityType": "application",
  "entityId": "uuid-or-reference",
  "reason": "business reason when present",
  "before": {},
  "after": {},
  "metadata": {
    "sourceLedger": "hiring_decisions"
  },
  "createdAt": "2026-09-04T00:00:00.000Z"
}
```

The export manifest is returned inside `filters.manifest` to preserve the existing public OpenAPI shape. It includes export version, complete-by-default state, per-ledger counts, redaction policy and a SHA-256 digest over the serialized exported event array.

## Secret handling

Audit permission is privileged, but exports still recursively redact values whose keys look like credentials or secrets, including passwords, passphrases, tokens, authorization/cookie fields, API keys, private keys and credential fields. Business evidence/provenance is preserved; authentication material is not an audit artifact.

## Export audit

Every successful export writes a new `audit.export.generated` event with actor, filters, record count, per-ledger counts and the SHA-256 digest. That receipt is intentionally created after the snapshot is assembled, so the export does not mutate the dataset it is hashing.

## Integrity boundary

The SHA-256 digest detects accidental modification of the event array after export generation. It is not a digital signature and does not replace database backup, WORM/immutable storage, external timestamping or cryptographic signing if those controls are required by a customer or jurisdiction.
