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
- [ ] Confirm exact-commit CI for reprocessing migration and stale claim regression (`d2d5b8ceba079a43d0722d284f3dbca4990721bf`, quality-gate `40379984710` started).
- [x] Tenant-scoped candidate intelligence read API exposes source-anchored resume assertions and versioned job skill requirements.
- [x] Implement permission-scoped human review/write API, corrected mapping to existing canonical skills, optimistic concurrency, versioned review history and event log (implementation; CI for latest SHA pending).
- [x] Generated OpenAPI/client drift resolved and contract verification passed on `0e3b3326`; repeat on every API contract change.
- [x] Read-only candidate workspace displays expected job skill levels, declared claims, their original excerpt and confidence separately from assessed competence.
- [x] Job editing UI for versioned skill levels/weights is in main (`f7e55d9`); retain the pre-existing candidate read-only claim source display.
- [x] Candidate HR review UX (reason, correction, stale-version conflict refresh) and persisted-browser HR regressions are in `main` and passed quality-gate `40378901769`.
- [ ] LLM extraction proposals with strict schema, confidence and safe fallback; extend taxonomy aliases only via review.
- [x] Optional job-to-existing-rubric criterion mapping UI and tenancy/reload/revision tests pass on `0e3b3326`; mapping intentionally does not modify pinned rubric scores.\n- [ ] Validate full multi-resume, multi-tenant, cross-version replay scenarios and external provider/calibration gates.

## Phase 2 — structured question bank: TODO
Retain existing private disk upload and per-application selection; add immutable question versions, skill/source mappings, review/approval UI, audited LLM proposals and frozen interview snapshots. Tests: file, isolation, prompt injection, source selection, browser.
## Phase 3 — versioned adaptive planner: TODO
Persist application plan with common/adaptive split, evidence quotas, question provenance, worker recovery/reconnect and strict fallback disclosure. Tests: replay, negative, worker and browser.
## Phase 4 — skill evidence evaluator/report: TODO
Join turn/transcript/evidence to per-skill competency, four resume-claim states, deterministic rubric scoring, traceable matrix and human review audit. Tests: inadequate/conflicting evidence, idempotent replay, score consistency.
## Phase 5 — full hiring journey and operational gates: TODO
Request Senior .NET developer → HR approval → job/rubric → question upload → candidate intake → selected documents → live interview → human-reviewed report. Real LLM/RTC/camera/STT/TTS and production calibration are **VALIDATION_PENDING** until exercised and recorded.

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
- New feature commits: `05c074f` job requirements and basic review; `f7e55d9` Persian job editing; `e1a813d` corrected mapping, ordered history, expectedVersion and migration 0071; `3599bfa` PostgreSQL review tests; `934c5cf`/ `1108eb6` HR review UI; `9efa3a3` rubric criterion mapping; `5b09b59` browser job editor; `0e3b332` reviewer browser test fixture fix; `ec0b730` evidence-preserving reprocessing; `d2d5b8c` reprocessing after human-review regression.\n- **CI_VALIDATED** for 0e3b332: quality-gate `40378901769` success with migrations, contracts, lint, TypeScript, API/DB tests, Build, Chromium browser critical flows. **CI_PENDING** on d2d5b8c; do not transfer older green status.
- No production readiness claimed.

## Immediate next action
Verify quality-gate for the latest `main` after reprocessing and documentation. If green, begin the still-unfinished phase-1 opt-in LLM skill extraction proposal workflow (typed schema, source spans, explicit review, failure fallback) and extend integration tests. Never label Phase 1 DONE without release gates and real provider validation.
