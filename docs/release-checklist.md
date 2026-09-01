# Production Release Checklist

A release is eligible for production only when every required item below has evidence. Realtime media items are explicitly separate so the non-Realtime product can be released without pretending LiveKit/FFmpeg/Whisper runtime is ready.

## 1. Source and CI integrity

- [ ] Release commit is on the intended protected branch/tag.
- [ ] GitHub `quality-gate` is green for the exact release commit (or its deterministic generated-contract follow-up commit).
- [ ] `npm ci` uses the public npm registry configured by CI; no mandatory private registry remains.
- [ ] Production dependency audit has no `high` or `critical` findings.
- [ ] `npm run lint` is green.
- [ ] `npm run typecheck` is green.
- [ ] `npm run test` is green, including PostgreSQL integration tests.
- [ ] `npm run build` is green.

## 2. Database and migrations

- [ ] `node scripts/check-migrations.mjs` is green.
- [ ] Migrations apply from an empty supported PostgreSQL database.
- [ ] Re-running migrations produces only `skip` for already-applied files and no checksum drift.
- [ ] `npm run db:performance` is green after migrations.
- [ ] Schema change follows expand/contract compatibility.
- [ ] A verified backup exists before any migration with material data risk.
- [ ] Restore procedure in `docs/backup-restore-runbook.md` has been exercised for the environment/risk tier.

## 3. API contract

- [ ] `npm run api:sync` succeeds.
- [ ] `openapi/openapi.json` matches real controllers.
- [ ] `packages/api-client/src/generated/schema.ts` is regenerated from that OpenAPI file.
- [ ] Generated contract files are committed and there is no contract drift.
- [ ] Frontend production paths use the typed API client for supported endpoints rather than ad-hoc fetch contracts.

## 4. Authentication, authorization, tenancy

- [ ] Login/password hashing/session persistence tests pass.
- [ ] Refresh rotation/reuse detection/logout/password-reset tests pass.
- [ ] Candidate invitation and organization user-management lifecycle tests pass.
- [ ] Permission Guard tests pass.
- [ ] Tenant-isolation tests pass for representative read/write paths.
- [ ] Cookie/security policy is correct for production HTTPS.
- [ ] CORS origin list is explicit for production.
- [ ] CSRF origin validation is enabled for cookie-authenticated mutations.
- [ ] Rate limits and abuse controls are enabled for authentication/invitation/public candidate surfaces.

## 5. Product data surfaces

- [ ] Command Center loads persisted database data with loading/empty/error states.
- [ ] Jobs UI reads/writes through real API contracts.
- [ ] Candidates UI reads persisted data through real API contracts.
- [ ] Candidate Intelligence uses persisted evidence and typed API contracts.
- [ ] Analytics uses persisted recruitment events/data and handles empty data.
- [ ] No production route depends on `demo-data.ts` or hard-coded fixture candidate/job identifiers.

## 6. Sourcing, outreach and scheduling

- [ ] Source policy and provider allow/deny rules are versioned.
- [ ] Source runs are idempotent and retry-safe.
- [ ] Candidate dedup/merge retains provenance.
- [ ] Import/export and source audit preserve evidence provenance.
- [ ] Outbound delivery states and failures are persisted.
- [ ] Human approval gates are enforced where configured.
- [ ] Screening hard minimums and human review states are tested.
- [ ] Scheduling stores a valid IANA timezone.
- [ ] Email/calendar integrations can remain provider stubs only when the release scope explicitly excludes external delivery/calendar execution.

## 7. Interview Brain and evaluator

- [ ] Interview plan is generated from a published/versioned rubric.
- [ ] Required competency coverage is represented in the plan.
- [ ] min/max depth and time budget are enforced/tested.
- [ ] duplicate/unsupported question guards are tested.
- [ ] LLM timeout and invalid structured-output paths have deterministic fallback.
- [ ] persisted turn/resume-after-crash behavior is tested.
- [ ] only finalized/approved `spoken_text` can cross the speech boundary.
- [ ] evaluator input contains final transcript/evidence/rubric references only.
- [ ] insufficient-evidence state is possible and distinct from a low score.
- [ ] evidence citations and confidence are persisted.
- [ ] human override requires a reason and remains auditable.
- [ ] evaluator calibration evidence exists for the evaluator version being released.
- [ ] recommendation remains decision support; final hiring authority stays human-controlled.

## 8. Assessment

- [ ] Definitions, assignments, submissions and test-case contracts are versioned/persisted.
- [ ] Normalized scoring and evidence/integrity signals are tested.
- [ ] Human review workflow is available.
- [ ] Runner API contract declares resource/network restrictions.
- [ ] If untrusted code execution is in release scope, an isolated sandbox worker must be deployed and separately security-reviewed. Contract-only mode must not claim executable assessment support.

## 9. Candidate experience

- [ ] Invitation token states include valid, expired, invalid/already-used behavior.
- [ ] Candidate identity and limited candidate session are enforced.
- [ ] Privacy disclosure, AI interview consent and recording consent are versioned/persisted.
- [ ] Camera/microphone permission/readiness UI works without claiming a Realtime room exists.
- [ ] Reconnect/offline UI is present.
- [ ] Interview instructions and completion page are present.
- [ ] Persian and English surfaces are checked in RTL/LTR.
- [ ] Keyboard/focus labels and mobile layouts are manually smoke-tested.

## 10. Production hardening

- [ ] `/health` returns liveness.
- [ ] `/health/ready` verifies database/migration readiness.
- [ ] `/metrics` is scraped only from an appropriately restricted network/path.
- [ ] Structured logs contain correlation/trace identifiers and do not contain secrets/tokens.
- [ ] Security headers are enabled.
- [ ] S3-compatible storage credentials come from secret references/environment, not source control.
- [ ] Retention jobs default to dry-run for manual execution and honor legal holds.
- [ ] Privacy deletion requires approved workflow and creates an audit/deletion receipt.
- [ ] Session/refresh/invitation/password-reset cleanup jobs are configured.
- [ ] Audit export is restricted to `audit.read` and remains tenant-scoped.
- [ ] Backup/restore evidence exists.
- [ ] `npm run db:performance` is green.
- [ ] Load test is run against a production-like environment with documented thresholds, for example:

```bash
LOAD_TEST_URL=https://staging.example.com \
LOAD_TEST_PATHS=/health,/health/ready \
LOAD_TEST_REQUESTS=2000 \
LOAD_TEST_CONCURRENCY=40 \
LOAD_TEST_P95_MAX_MS=750 \
npm run load:test
```

Record p50/p95/p99, requests/sec, status counts and error rate with the release evidence.

## 11. Realtime runtime gate (only when Realtime is in release scope)

The non-Realtime release may mark this section `not in scope`. It must never be silently treated as passed.

- [ ] LiveKit Server deployment and TURN reachability validated.
- [ ] FFmpeg runtime validated.
- [ ] whisper.cpp/STT runtime validated.
- [ ] VAD/STT/TTS providers pass readiness probes.
- [ ] short-lived room credential issuance tested with real provider runtime.
- [ ] participant/reconnect/TURN failure and idempotent event journal tested end-to-end.
- [ ] raw-media retention policy and recording consent behavior validated.

## Release approval

Capture: release commit SHA, generated-contract commit SHA if separate, CI run URL/ID, migration count, backup reference/checksum, load-test evidence, known exclusions, approver, release operator and UTC deployment timestamp.
