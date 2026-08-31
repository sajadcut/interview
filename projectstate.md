# AI Recruiter Platform — PROJECT STATE

> **Status:** M0 foundation + enterprise visual target implemented statically; local runtime validation pending  
> **Version:** 0.7.0  
> **Date:** 2026-08-31  
> **Repository:** https://github.com/sajadcut/interview  
> **Branch:** `main`

---

# 1. Current state

```text
Product architecture                     ✅ Defined
Core technical architecture              ✅ Defined
Interview architecture                   ✅ Defined
Production-readiness gates               ✅ Defined
Laptop-first dev baseline                 ✅ Locked
Foundation audit                          ✅ Completed statically
Enterprise visual product target          ✅ Coded on main
Local install / build / DB validation     ⏳ PENDING
Executable browser screenshot review      ⏳ PENDING
T012 CI                                   ➡️ NEXT after local validation
M1 domain vertical slice                  ⬜ Not started
Production approval                       ⬜ Not approved
```

No runtime/build/test success is claimed until commands are executed on the development laptop or CI.

---

# 2. Source of truth

- `master.md` — stable product and architecture contract.
- `projectstate.md` — actual execution status.
- `production-readiness.md` — autonomous-interview release gates.
- `AGENTS.md` — implementation rules.
- `docs/visual-product-target.md` — visual implementation acceptance contract.

---

# 3. Foundation audit corrections already implemented

The audit found and corrected material gaps in environment loading, database migration execution, tenant/RBAC trust boundaries, tenant-safe storage retrieval, AI structured-output validation, shared UI packaging, and regression-test coverage.

Important constraints remain locked: Candidate organization-global, Application job-specific, Evidence before score, deterministic final score, human consequential decisions, approved sourcing adapters only, provider abstractions, no unsupported biometric/personality inference, and local-native laptop development.

---

# 4. T001–T011 actual status

| Ticket | Actual status |
|---|---|
| T001 Repository bootstrap | `STATIC_COMPLETE / RUNTIME_VALIDATION_PENDING` |
| T002 Local prerequisites | `REPO_COMPLETE / LOCAL_POSTGRES_PENDING` |
| T003 API baseline | `STATIC_COMPLETE / RUNTIME_VALIDATION_PENDING` |
| T004 Database baseline | `STATIC_COMPLETE / DATABASE_EXECUTION_PENDING` |
| T005 Tenant context | `STATIC_COMPLETE / DB_INTEGRATION_PENDING` |
| T006 Authorization | `STATIC_COMPLETE / DB_INTEGRATION_PENDING` |
| T007 Audit foundation | `STATIC_COMPLETE / DATABASE_EXECUTION_PENDING` |
| T008 StorageProvider | `STATIC_COMPLETE / FS+DB_VALIDATION_PENDING` |
| T009 AI Gateway | `STATIC_COMPLETE / UNIT_RUNTIME_PENDING` |
| T010 Web / Design System | `VISUAL_TARGET_CODED / BROWSER_BUILD_REVIEW_PENDING` |
| T011 Typed API client | `SETUP_COMPLETE / GENERATION_VALIDATION_PENDING` |
| T012 CI | `NOT STARTED` |

T010 is explicitly not considered DONE merely because UI primitives exist. See `docs/visual-product-target.md`.

---

# 5. Coded visual surfaces

```text
/app
→ Enterprise Command Center

/app/jobs
→ Jobs table

/app/jobs/new
→ AI Job Description Builder

/app/jobs/senior-backend-engineer
→ Job Workspace Overview

/app/jobs/senior-backend-engineer/candidates
→ Job candidate table

/app/jobs/senior-backend-engineer/pipeline
→ Pipeline / Kanban

/app/candidates
→ Organization-wide Candidates table

/app/candidates/ali-rahimi
→ Candidate Intelligence Workspace

/app/interviews
→ Interview Hub list

/app/interviews/ali-rahimi
→ AI Interview Review / evidence-score surface
```

The visual pages currently use deterministic development fixtures. This is a real React/Next implementation, not a generated screenshot, but the data is not yet domain-persisted.

---

# 6. Visual target rules

The approved direction is an information-dense Enterprise AI Recruiter, not a generic admin dashboard.

Required patterns include navigation hierarchy, advanced tables, tabs, filters, job workspaces, candidate intelligence, pipeline/kanban, score breakdowns, evidence-oriented interview review, compact recruiter actions, and AI assistance clearly separated from human decision authority.

A screenshot generated independently from the application never counts as UI implementation acceptance.

---

# 7. Local validation gate

Run after pulling `main`:

```bash
pnpm install
cp .env.example .env
pnpm workstation:check
pnpm db:check
pnpm db:migrate
pnpm dev:bootstrap
pnpm api:sync
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

Then review at minimum desktop screenshots for:

```text
/app
/app/jobs/senior-backend-engineer
/app/jobs/senior-backend-engineer/candidates
/app/jobs/senior-backend-engineer/pipeline
/app/jobs/new
/app/candidates
/app/candidates/ali-rahimi
/app/interviews/ali-rahimi
```

Repeat visual review with `NEXT_PUBLIC_DEFAULT_LOCALE=fa` and `en` for directionality issues.

Any failure reopens the relevant ticket.

---

# 8. Next real engineering action

1. Execute the local validation gate.
2. Fix every compile/runtime/visual issue found.
3. Capture screenshots from the running Next.js application and compare against the approved visual target.
4. Commit the generated `pnpm-lock.yaml` after a real install.
5. Implement T012 CI using the validated commands.
6. Start M1 Job → Candidate → Evidence vertical slice and replace development fixtures route-by-route with typed APIs.

No later interview/media milestone should bypass this sequence.
