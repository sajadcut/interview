# AI Recruiter Platform — PROJECT STATE

> **Status:** M0 foundation + enterprise visual target implemented statically; Node 22.14 runtime baseline adopted; local runtime validation pending  
> **Version:** 0.8.0  
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
Node.js 22.14 runtime baseline             ✅ Approved / enforced in repo
Dotin Nexus npm registry                   ✅ Required / configured
Foundation audit                          ✅ Completed statically
Enterprise visual product target          ✅ Coded on main
Local install / build / DB validation     ⏳ PENDING
Executable browser screenshot review      ⏳ PENDING
T012 CI                                   ➡️ NEXT after local validation
M1 domain vertical slice                  ⬜ Not started
Production approval                       ⬜ Not approved
```

No runtime/build/test success is claimed until commands are executed successfully on the development laptop or CI.

The active runtime is `Node.js >=22.14.0 <23` with pnpm 11. ADR-0001 supersedes only the Node.js 24 version statements in `master.md` v0.4.0; all other locked decisions remain unchanged.

---

# 2. Source of truth

- `master.md` — stable product and architecture contract, except the Node runtime version superseded by ADR-0001.
- `docs/architecture-decisions/ADR-0001-node-22-14-runtime.md` — active Node.js runtime decision.
- `projectstate.md` — actual execution status.
- `production-readiness.md` — autonomous-interview release gates.
- `AGENTS.md` — implementation rules.
- `docs/visual-product-target.md` — visual implementation acceptance contract.

---

# 3. Foundation audit corrections already implemented

The audit found and corrected material gaps in environment loading, database migration execution, tenant/RBAC trust boundaries, tenant-safe storage retrieval, AI structured-output validation, shared UI packaging, and regression-test coverage.

Additional workstation corrections now implemented:

- Dotin Nexus is the required repository registry through root `.npmrc`.
- pnpm dependency build scripts use an explicit allow/deny policy.
- `esbuild` lifecycle builds are approved; `@scarf/scarf` is denied.
- Node.js runtime is pinned to 22.14.0 for local development and constrained to `>=22.14.0 <23`.
- workstation validation checks the actual Node and pnpm major versions.

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

Run after pulling `main` with Node.js 22.14.0:

```bash
node -v
pnpm -v
pnpm config get registry
pnpm registry:check
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

Expected runtime/registry baseline:

```text
Node.js   v22.14.0 or newer 22.x, below 23
pnpm      11.x
registry  https://nexus3.dotin.ir/repository/Dotin-NPM/
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

1. Pull the Node 22.14 baseline changes.
2. Re-run dependency installation against Dotin Nexus under the repository build-script policy.
3. Execute lint, typecheck, tests and build; fix every real failure.
4. Run the application and capture browser screenshots from Next.js.
5. Compare executable screenshots against the approved visual target and close visual gaps.
6. Commit the generated `pnpm-lock.yaml` only after successful Node 22.14 validation.
7. Implement T012 CI using the validated Node 22.14 commands.
8. Start M1 Job → Candidate → Evidence vertical slice and replace development fixtures route-by-route with typed APIs.

No later interview/media milestone should bypass this sequence.
