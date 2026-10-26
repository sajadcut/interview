---
name: interview-recruitment-workflow
description: Implement, debug, or test Interview's end-to-end hiring request, HR approval, job publication, resume intake, candidate matching, application, technical approval, and interview scheduling flows. Use for recruitment lifecycle and related CRUD/UX work.
---

# Recruitment workflow

Use this skill for the organization's actual hiring lifecycle, not an isolated mock page. Read `AGENTS.md`, `master.md`, `projectstate.md`, and the relevant current API/controller code before changing behavior.

## Source of truth

- Requisition API/policy: `apps/api/src/recruiting/hiring-requests.controller.ts`, `hiring-requests.service.ts`, `hiring-workflow-policy.ts`.
- Recruiter UI: `apps/web/app/app/hiring-requests/page.tsx`, `apps/web/app/app/jobs/page.tsx`, `apps/web/components/recruiting/job-create-form.tsx`, `job-edit-form.tsx`, `job-recruiting-workspace.tsx`.
- Resume intake/matching: `apps/web/components/recruiting/candidate-resume-intake-panel.tsx` and `apps/api/src/resumes/candidate-resume-intake.service.ts`.
- API contracts: `openapi/openapi.json`, `packages/api-client/src/generated/schema.ts`; migrations: `packages/db/migrations/`.
- Workflow description: `projectstate.md` (Hiring Requisition and Resume-first Candidate Intake sections).

## Implement or investigate in this order

1. Trace the requested role: requesting team creates a hiring request; HR reviews/approves; HR creates a linked job; requesting team contributes required technical approval at the applicable gate. Do not let one actor silently bypass another actor's permissions.
2. Verify the job lifecycle: create draft -> edit requirements/rubric -> publish via `POST /v1/jobs/{jobId}/publish` -> manage open/paused/closed states. Never open a job merely by mutating `status`; publishing is a dedicated action. Verify published rubric/version requirements before application intake.
3. Trace resume-first intake: PDF/DOCX -> extraction -> organization-global Candidate deduplication -> evidence-concept matching -> **explicit HR confirmation** -> job-specific Application with pinned published rubric. Never duplicate a Candidate for each Job.
4. Follow the Application through screening, scheduling, invitation, interview and human-reviewed decision. Preserve job-scoped status/scorecard provenance and audit events.
5. For collections (jobs, candidates, requisitions), cover create, searchable/filterable list, edit, safe single/bulk delete where permitted, empty/loading/error states, confirmation, selection reset on filter changes, and authorization. Deletion must respect backend dependency rules; never pretend a blocked deletion succeeded.
6. Check cross-tenant reads/writes, roles, idempotency, duplicate resumes, draft publishing errors, missing approvals and failures in downstream services.

## Validation

- Prefer targeted tests around `apps/api/src/recruiting/`, `apps/api/src/resumes/`, and relevant web components; extend Playwright E2E cases in `e2e/` for a real browser flow.
- Regenerate versioned contracts after API changes with `npm run api:sync` and inspect the generated diff.
- Run `npm run web:contracts`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` when executable, plus `npm run e2e` with the full stack ready.
- A deterministic fixture or mocked E2E result is **not** proof that a real HR-to-interview journey works with persisted data. Record exact blockers and commands, rather than claiming success.

## Definition of done

Provide a traceable scenario (request ID -> job ID -> candidate ID -> application ID -> interview session ID), verified authorization boundaries, acceptance/test evidence and any unresolved real-provider dependencies. Final hire/reject decisions remain human-controlled.
