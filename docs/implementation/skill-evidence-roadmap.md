# Skill Evidence Graph & Adaptive Interview — implementation status

Repository: https://github.com/sajadcut/interview · target: `main`
Initial architecture baseline: `3d7267ab8f6ed9bfb30ca3814ffa42643cfd9c7c` (2026-10-26). Current progress is tracked against exact latest `main` commits.
This is an execution log, not a claim of production readiness. Do not mark a phase DONE without its complete acceptance gates.

## Phase 0 — architecture gap analysis: DONE (source inspection only)

| Component | Existing implementation | Gap / required change | Relevant files | Acceptance |
|---|---|---|---|---|
| Jobs and rubric | `job_requirements`, published `rubric_versions`, `rubric_criteria`, pinned application rubric | No canonical skill ID, levels or required evidence per skill | `0008_m1_job_candidate_evidence.sql`, `0058_m1_closure.sql`, jobs services | Versioned skill↔job↔rubric links, publication-compatible tests |
| Candidate & resume | Org-global candidate, structured profile, `candidate_skills`, `evidence`, chunks | Resume skill does not have a stable taxonomy edge with source span and human-review state | `resumes/resume-ingestion.service.ts`, `resume-parser.ts`, `0035_resume_ingestion.sql` | Span-anchored, deduplicated claims, tenant/reload/duplicate tests |
| Resume matching | Deterministic requirement/evidence concept score; LLM explanation not scoring authority | Synonyms/manual override and skill-level required/claimed comparison missing | `sourcing/evidence-match-engine.ts`, `candidate-resume-intake.service.ts` | No invented skill matches, separate pre-interview score |
| Question bank | Local filesystem via StorageProvider, tenant/job-bound PDF/DOCX/TXT, extracted questions as JSON | No individually approved/versioned question entities or question↔skill links | `question-bank/*`, `0066`–`0068` migrations | Approval/versioning, chosen candidate sources, malicious-input tests |
| Document selection | Per application, job/tenant validated, locked after non-failed interview session | Need explicit versioned snapshot linked to plan/questions | `question-bank.service.ts`, `application-question-document-picker.tsx` | Immutable and replay-safe selection |
| Interview engine | Interview Brain, adaptive follow-up, rubric lifecycle and per-turn document provenance | Missing persisted comprehensive plan and skill-by-skill evidence budget | `interviews/*`, interviewer service, `0064`, `0068` | Real LLM/turn/reconnect/restart tests |
| Evaluation | Evidence-backed independent evaluator and deterministic rubric scoring | No candidate-facing skill matrix/claim verification built from question-turn evidence edges | `interview-evaluator.ts`, `interview-review.service.ts` | Unknown ≠ zero, replay, human audit |
| Report UX | `/app/interviews/{sessionId}` review workspace | No full skill/resume/question traceability matrix | `interview-review.tsx` | Real HR browser evidence and permissions |
| Operations | CI, local-first dev, production gate policy | Real provider/hardware/calibration gates not completed here | `quality-gate.yml`, `production-readiness.md` | Exact-commit CI and supervised real-runtime validation |

**Target entity path:** Job → job_skill_requirements → skill_taxonomy ← resume_skill_claims ← resume/evidence → approved question versions → immutable Interview Plan → interview turns/transcript → verified skill evidence → skill evaluations → human-reviewed report.

**Contracts:** `organization_id` is mandatory on all new domain edges; Candidate is organization-global; Application is job-specific; raw resume text is evidence, never proof. Resume match remains separate from interview evaluation. Pinned published rubric and deterministic weighted score remain authoritative; LLM suggestions cannot silently change them. All candidate-affecting conclusions require human review.

## Phase 1 — central skill model and resume claims: IN_PROGRESS
- [x] Define additive relational taxonomy, aliases, versioned job skill objectives and anchored resume skill claims in `0069_skill_evidence_foundation.sql`.
- [x] Deterministic, conservative .NET skill alias mapping and source offsets in `resume-skill-mapping.ts`; add negative unit tests.
- [x] Ingestion transaction writes new taxonomy and evidence-linked resume claim edges for curated, literally anchored skills; unmatched skill labels remain in existing `candidate_skills`.
- [x] Execute PostgreSQL migration/integration and static/unit tests in Node 25/npm 11 CI for baseline claim graph (quality-gate `40375173175`, passed on `0370602`).
- [x] Complete exact-commit CI for the active skill review/job editing and Chromium HR regression at `0e3b3326e3e6a9b87a592d2b4191792bf8c1046b` (quality-gate `40378901769`, success).
- [x] Preserve human-reviewed claim history during parser reprocessing; rebind re-anchored evidence and hide stale claims (`0072_resume_claim_reprocessing.sql` and new PostgreSQL regression).
- [x] CI for resume reprocessing regression: quality-gate `40379984710` passed on `d2d5b8ceba079a43d0722d284f3dbca4990721bf`; final HEAD checks are separate.
- [x] Tenant-scoped candidate intelligence read API exposes source-anchored resume assertions and versioned job skill requirements.
- [x] Implement permission-scoped human review/write API, corrected mapping to existing canonical skills, optimistic concurrency, versioned review history and event log (implementation; CI for latest SHA pending).
- [x] Generated OpenAPI/client drift resolved and contract verification passed on `0e3b3326`; repeat on every API contract change.
- [x] Read-only candidate workspace displays expected job skill levels, declared claims, their original excerpt and confidence separately from assessed competence.
- [x] Job editing UI for versioned skill levels/weights is in main (`f7e55d9`); retain the pre-existing candidate read-only claim source display.
- [x] Candidate HR review UX (reason, correction, stale-version conflict refresh) and persisted-browser HR regressions are in `main` and passed quality-gate `40378901769`.
- [x] Implemented opt-in LLM extraction proposal workflow: bounded OpenAI-compatible call, strict versioned JSON schema, tenant-canonical skill allowlist, exact source offsets/hash, model confidence, safe disabled/unavailable fallback, tenant-scoped persisted proposals, explicit HR approval/rejection, optional reviewed aliases and immutable audit events (`0073_skill_extraction_proposals.sql`, `skill-proposal-*`, `skill-proposals.*`).
- [x] Persian UI presents explicit remote-model opt-in, retrieved suggestions, human review reasons, optional literal aliases and clear unverified status.
- [x] Strict schema, HTTP transport/fallback, PostgreSQL tenant/idempotency/alias collision/stale source and browser explicit opt-in tests passed: exact code commit `35cae658ed708a05074d86586a39bcdb846033fa`, GitHub quality-gate `40382992327` **success**.
- [ ] Exercise a real organization-approved LLM endpoint with a supervised consented resume, calibrate offsets/confidence, and verify PII/privacy processing boundaries; deterministic fallback remains authoritative.
- [x] Optional job-to-existing-rubric criterion mapping UI and tenancy/reload/revision tests pass on `0e3b3326`; mapping intentionally does not modify pinned rubric scores.
- [x] Added PostgreSQL acceptance coverage for two distinct resumes of the same candidate, a common skill across both sources, identical uploaded bytes across two tenants, deduplicated replay, parser-version reprocessing and unaffected human-review history (`d80ced99`, `d93f8589`); exact-code quality-gate `40385809611` **success**.
- [x] Hide stale LLM suggestions from the current resume workspace using exact stored text SHA while retaining immutable review history; regression for stale read and stale human action (`9ba1cb0b`); validated with later code commit `d93f8589` in quality-gate `40385809611` **success**.
- [ ] Complete remaining expanded multi-resume/application/job-rubric cross-version acceptance and real provider calibration, privacy/consent gates.

## Phase 2 — structured question bank: IN_PROGRESS (begun at user request; Phase-1 operational sign-off still blocked)
Retain existing private disk upload and per-application selection; add immutable question versions, skill/source mappings, review/approval UI, audited LLM proposals and frozen interview snapshots. Tests: file, isolation, prompt injection, source selection, browser.
- [x] Implement `0074_versioned_question_bank.sql`: tenant- and job-bound question entities, append-only versions, source excerpt and existing-skill links, human-only approval events and immutable per-application selection snapshots.
- [x] Add question create/revise/review/list endpoints, stale version conflicts and immutable selection snapshot read; persisted acceptance test `question-versions.postgres.integration.spec.ts`.
- [x] Exact-code CI for the Phase-2 structured question slice: `8043fc4b8a0d6338177b462a795c7f285208332a`, GitHub Actions quality-gate `40392542051` **success** (PostgreSQL migrations/integration, OpenAPI contract drift, lint, TypeScript, Build and Playwright). Existing local-disk upload/reload browser regression also passed; persistent volume deployment remains operational validation pending.
- [x] Persian question create/revise/approve/reject UI in `question-versions-panel.tsx` and `e2e/question-versions.spec.ts`, validated on `8043fc4`.
- [x] Bounded, explicitly consented LLM question generation backed by immutable per-version source/model provenance (`0075_question_bank_llm_provenance.sql`). Drafts remain pending, deduplicated and job-skill-allowlisted; existing human-only question review determines approval and approved snapshots. Malicious-output, tenant, replay, audit-provenance and browser opt-in regressions added. Validated on `4dfd407efa803713da3ff829e1e592a94d976c1c`, quality-gate `40659548142` **success**, merged in `16cde001a9b94120096b894de36513dbfae5d5fb`.
- [ ] Persist and consume the approved selection snapshot in the *live* interview plan/turn ledger (including reconnect/replay); current snapshot remains application-scoped, not yet a complete live Interview Plan.
- [ ] Verify supervised live provider, disk volume persistence and interviewer snapshot replay end-to-end.
### Phase-2 verified increment
- Migration: `0074_versioned_question_bank.sql` — append-only question, version, reviewer decision, selection snapshot contracts.
- API: `question-versions.controller.ts`, `question-versions.service.ts`, DTOs; version conflict and literal source excerpt checks; selection snapshots from `question-bank.service.ts`.
- UI: Persian authoring/review panel in `question-bank-workspace.tsx`.
- Tests: `question-versions.postgres.integration.spec.ts`, `question-versions.spec.ts`; legacy question-bank upload/reload behavior still verified.
- Exact commit **CI_VALIDATED**: [quality-gate 40392542051](https://github.com/sajadcut/interview/actions/runs/40392542051) on `8043fc4b8a0d6338177b462a795c7f285208332a`.
- Newly **CI_VALIDATED**: human opt-in LLM question generation, immutable model/source coordinates, literal excerpt and prompt-delimiter checks, no automatic question approval, tenant/idempotence, and source-selected approved snapshot replay. Relevant code/tests: `question-proposals.*`, `question-proposal-*.ts`, `question-llm-proposals.spec.ts`, `0075_question_bank_llm_provenance.sql`. Browser regression in `e2e/recruiter-critical.spec.ts` disambiguates a resume name also rendered in the resume picker.
- Still **NOT READY** for Phase-2 sign-off: live interviewer plan/turn consumption and restart replay, supervised approved-model output calibration, privacy boundary sign-off, and production persistent-volume disk test. Existing mock provider/CI validates controls, not a real provider.

## Phase 3 — versioned adaptive planner: TODO
Persist application plan with common/adaptive split, evidence quotas, question provenance, worker recovery/reconnect and strict fallback disclosure. Tests: replay, negative, worker and browser.
## Phase 4 — skill evidence evaluator/report: TODO
Join turn/transcript/evidence to per-skill competency, four resume-claim states, deterministic rubric scoring, traceable matrix and human review audit. Tests: inadequate/conflicting evidence, idempotent replay, score consistency.
## Phase 5 — full hiring journey and operational gates: TODO
Request Senior .NET developer → HR approval → job/rubric → question upload → candidate intake → selected documents → live interview → human-reviewed report. Real LLM/RTC/camera/STT/TTS and production calibration are **VALIDATION_PENDING** until exercised and recorded.

## Recent Phase-1 additions (LLM extraction proposals)
- `packages/db/migrations/0073_skill_extraction_proposals.sql` — tenant-scoped pending proposals, immutable review events and source SHA.
- `apps/api/src/recruiting/skill-proposal-validation.ts` / `.spec.ts` — strict structured output, literal spans, canonical skill allowlist and alias validation.
- `apps/api/src/recruiting/skill-proposal-provider.ts` — 8-second bounded opt-in OpenAI-compatible completion with disabled/unavailable fail-closed behavior.
- `apps/api/src/recruiting/skill-proposals.service.ts` / `.controller.ts` / `.dto.ts` — read, explicitly generate and human-review typed endpoints with audit and version guards.
- `apps/api/src/recruiting/skill-proposals.postgres.integration.spec.ts` — database evidence, tenant, replay, alias conflicts, stale source and no auto scoring.
- `apps/web/components/recruiting/candidate-skill-proposals-panel.tsx` — Persian opt-in and human-review controls.
- `e2e/skill-proposals.spec.ts` — no implicit model request in browser; provider-disabled fail closed.
- `apps/api/src/recruiting/skill-proposal-provider.spec.ts` — explicit endpoint, masked provider error, valid completion and no implicit remote fallback.
- `apps/api/src/resumes/resume-ingestion.postgres.integration.spec.ts` — additional independent multi-resume/tenant/common-skill and parser-upgrade replay acceptance checks.
- `apps/api/src/recruiting/skill-proposals.service.ts` — current-version SHA filter to prevent stale proposal visibility.
- `apps/api/src/recruiting/skill-proposals.postgres.integration.spec.ts` — regression proves old proposals remain stored while current-read omits them.

## Changed paths in this increment
- `packages/db/migrations/0069_skill_evidence_foundation.sql` — additive relational model.
- `apps/api/src/resumes/resume-skill-mapping.ts` — conservative source anchoring.
- `apps/api/src/resumes/resume-skill-mapping.spec.ts` — focused negative cases.
- `apps/api/src/resumes/resume-ingestion.service.ts` — transactional claim insert.
- `apps/api/src/resumes/resume-ingestion.postgres.integration.spec.ts` — persisted claim replay/source and cross-tenant negative coverage.
- `apps/api/src/recruiting/candidate-intelligence.service.ts` — scoped read model for existing candidate intelligence API.
- `apps/web/components/recruiting/candidate-intelligence-workspace.tsx` — source and skill-gaps Persian UI.
- `master.md`, `projectstate.md` — architecture/current-state updates.
- `docs/implementation/skill-evidence-roadmap.md` — this log.

- `packages/db/migrations/0070_skill_requirements_review.sql` — audited reviewer action log and versioned requirement tombstones.
- `packages/db/migrations/0071_skill_claim_review_versions.sql` — optimistic claim corrections and audit history.
- `packages/db/migrations/0072_resume_claim_reprocessing.sql` — active/historical claim separation during resume reparse.
- `apps/api/src/recruiting/skill-evidence.controller.ts`, `skill-evidence.service.ts`, `skill-evidence.dto.ts` — scoped typed endpoints, human review events and revisions.
- `apps/web/components/recruiting/job-skill-requirements-editor.tsx` — editable job skill/rubric mapping.
- `e2e/skill-evidence.spec.ts` — browser HR job skill CRUD regression.
- `openapi/openapi.json`, `packages/api-client/src/generated/schema.ts` — generated versioned contracts.

## Validation evidence / commits
- Baseline inspected through GitHub connector. Local checkout not available: container has Node 22 / npm 10, no PostgreSQL or Dotin Nexus access; do **not** claim local DB, full unit, API or browser tests passed.
- Phase-1 baseline claim graph and migration `0069`: **CI_VALIDATED** on `0370602db1a891bf0a25d14fb16f6ca6db51f272`, quality-gate `40375173175` concluded success. New versioned human-review migration `0071` applied successfully in intermediate CI; exact latest SHA validation still pending.
- New feature commits: `05c074f` job requirements and basic review; `f7e55d9` Persian job editing; `e1a813d` corrected mapping, ordered history, expectedVersion and migration 0071; `3599bfa` PostgreSQL review tests; `934c5cf`/ `1108eb6` HR review UI; `9efa3a3` rubric criterion mapping; `5b09b59` browser job editor; `0e3b332` reviewer browser test fixture fix; `ec0b730` evidence-preserving reprocessing; `d2d5b8c` reprocessing after human-review regression.
- **CI_VALIDATED** for `0e3b332`: quality-gate `40378901769` success with migrations, contracts, lint, TypeScript, API/DB tests, build and Chromium critical browser flows. Reparse `d2d5b8c` quality-gate `40379984710` also passed.
- Opt-in LLM proposal sequence: `8cbb754` schema/provider validation; `5d4d34c` tenant-scoped API and review; `a701d29` PostgreSQL review coverage; `3d9bfe4` lint fixes; `07cce3b` Persian UI; `c76c7a0` explicit opt-in browser test; `4ef5b9b` concurrency-safe alias check; `3b1ca1b` conflict/stale source tests; `ba3b4fc` progress documentation; `35b1c8f` transport test; `4f317cb` require explicit provider URL; **`35cae658` final code commit — quality-gate `40382992327` success, API/DB load `40382992516` success.** No real organization-model request was executed; this is CI validation, not model calibration.
- Multi-resume/common-skill/parser replay and stale-proposal visibility: **CI_VALIDATED** at `d93f8589e5f69da33fbef48fa5ae5ce8584c24b8`; quality-gate `40385809611` successful including PostgreSQL tests, migration/contract drift, lint, TypeScript, Build and Playwright browser E2E. No provider live validation claimed.
- No production readiness claimed.

## Multi-resume replay acceptance checkpoint
| Scenario | Implemented regression | External sign-off |
|---|---|---|
| One candidate, two independently uploaded resumes | Distinct resume IDs; separate source evidence and original offsets | CI_VALIDATED on `d93f8589` (`40385809611`) |
| Same canonical skill claimed in both resumes | Separate per-resume claim IDs and anchored excerpts | CI_VALIDATED on `d93f8589` (`40385809611`) |
| Same file bytes in two organizations | Separate candidate/resume/claim namespace and forbidden cross-tenant read | CI_VALIDATED on `d93f8589` (`40385809611`) |
| Parser-version upgrade of second resume | First resume's claim review version/history untouched; only own evidence rebound | CI_VALIDATED on `d93f8589` (`40385809611`) |
| LLM proposal bound to superseded source hash | Current API excludes stale proposal; archived approval/event remains auditable | CI_VALIDATED on `d93f8589` (`40385809611`) |
| Live organization-approved LLM / real PII handling | Not exercised; approved credentials and consent needed | VALIDATION_PENDING |

## Immediate next action
Phase-1 code regression gates have passed, but **Phase 1 remains IN_PROGRESS** under the original definition because no consented real-organization LLM execution, calibration and privacy approval were available. This is an external operational acceptance blocker, not a CI failure. Phase 2 was started at the user's explicit request, without silently treating this prerequisite as satisfied. Phase-2 opt-in LLM question draft generation, tenant/job skill constraints, immutable audit provenance, human-review-controlled selection snapshots, and malicious-input/browser regressions are now CI-validated on `4dfd407` (quality-gate `40659548142` success). Merged into main as `16cde001`. Next implement **live immutable interview plan consumption and replay** of the selected approved questions. Do not call Phase 1 or 2 DONE until real organization-approved provider, consent/privacy calibration and operational gates pass.
Multi-resume and stale-source regressions are **CI_VALIDATED** through exact code commit `d93f8589e5f69da33fbef48fa5ae5ce8584c24b8`, quality-gate `40385809611` success. The subsequent documentation-only commit is separately checked. Remaining Phase-1 gates: approved-provider live test with explicit consent/privacy controls and model offset/confidence calibration, expanded application/job-rubric cross-version and tenant replay. Do not transition to Phase 2 until all acceptance checks pass on the exact commit; no resume claim or model proposal automatically becomes competency evidence or a hiring score.
