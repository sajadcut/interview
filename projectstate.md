# AI Recruiter Platform — PROJECT STATE

> **Status:** M0 JavaScript foundation validated on Windows; enterprise visual target builds successfully; browser review and database validation pending  
> **Version:** 0.9.4  
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
Node.js 25.9 runtime baseline             ✅ VALIDATED ON WINDOWS
npm 11.6 workspaces                       ✅ VALIDATED ON WINDOWS
Dotin Nexus npm registry                  ✅ VERIFIED ON WORKSTATION
Clean npm install                         ✅ SUCCESS (320 packages)
Workspace metadata check                  ✅ SUCCESS (8 workspaces)
JavaScript workstation check              ✅ NODE/NPM/GIT VERIFIED
Lint                                      ✅ SUCCESS
Typecheck                                 ✅ SUCCESS
API tests                                 ✅ 16/16 PASS
Production build                          ✅ SUCCESS
Next.js route generation                  ✅ 20/20 STATIC PAGES
package-lock.json                         🟡 GENERATED LOCALLY / COMMIT PENDING
Frontend executable browser review        ➡️ NEXT
PostgreSQL client                         ⏳ NOT INSTALLED / DB VALIDATION PENDING
T012 CI                                   ⏳ AFTER CANONICAL LOCKFILE
M1 domain vertical slice                  ⬜ NOT STARTED
Production approval                       ⬜ NOT APPROVED
```

The active JavaScript baseline is `Node.js >=25.9.0 <26` with `npm >=11.6.2 <12`, npm workspaces, Turborepo, and the required Dotin Nexus registry. ADR-0002 supersedes ADR-0001.

The Windows workstation has now successfully completed the repository JavaScript quality gate. This is based on real local execution, not static inspection.

---

# 2. Validated workstation evidence

The workstation reported:

```text
Node.js     v25.9.0
npm         11.6.2
Git         2.53.0.windows.3
Registry    https://nexus3.dotin.ir/repository/Dotin-NPM/
```

Registry validation succeeded against Dotin Nexus and resolved `@eslint/js 10.0.1`.

A clean npm recovery removed stale root/workspace dependency trees and completed successfully with 320 packages installed. The workspace checker validated all 8 npm workspace manifests and exact internal `@interview/*` versions.

---

# 3. JavaScript quality gate — validated

## Lint

`npm run lint` succeeded across all workspaces that define lint tasks.

```text
Tasks: 5 successful, 5 total
```

## Typecheck

`npm run typecheck` succeeded across API, web, DB, UI and API client workspaces.

```text
Tasks: 5 successful, 5 total
```

## Tests

`npm run test` executed the API test suite successfully:

```text
tests     16
pass      16
fail      0
```

Coverage includes AI structured-output validation, database-derived tenant authorization, permission guards, tenant guards, local storage traversal protection and tenant-scoped storage retrieval.

## Build

`npm run build` succeeded for both executable applications:

```text
@interview/api  -> tsc -p tsconfig.build.json      ✅
@interview/web  -> Next.js 16.3.3 production build ✅
Tasks: 2 successful, 2 total
```

Next.js compiled successfully, completed TypeScript validation, generated all 20 static pages, and finalized page optimization.

Validated routes include:

```text
/
/app
/app/analytics
/app/automations
/app/candidates
/app/candidates/ali-rahimi
/app/inbox
/app/integrations
/app/interviews
/app/interviews/ali-rahimi
/app/jobs
/app/jobs/new
/app/jobs/senior-backend-engineer
/app/jobs/senior-backend-engineer/candidates
/app/jobs/senior-backend-engineer/pipeline
/app/settings
/app/talent
/candidate
```

---

# 4. Source of truth

- `master.md` — stable product and architecture contract including Node 25/npm workspaces.
- `docs/architecture-decisions/ADR-0002-node-25-npm-runtime.md` — active runtime/package-manager decision.
- `projectstate.md` — actual execution status.
- `production-readiness.md` — autonomous interview release gates.
- `AGENTS.md` — implementation rules.
- `docs/visual-product-target.md` — visual implementation acceptance contract.

---

# 5. Workstation vs database prerequisites

The JavaScript workstation is now validated.

PostgreSQL remains intentionally separate. Missing `psql` does not invalidate frontend build/lint/typecheck/tests, but PostgreSQL 18.x remains required before database migrations, tenant/RBAC persistence, API persistence and full-stack M0 validation can be considered complete.

Database validation sequence later:

```powershell
Copy-Item .env.example .env -Force
npm run db:check
npm run db:migrate
npm run dev:bootstrap
npm run api:sync
npm run dev
```

---

# 6. T001–T012 actual status

| Ticket | Actual status |
|---|---|
| T001 Repository bootstrap | `NPM_WORKSPACE_RUNTIME_VALIDATED / LOCKFILE_COMMIT_PENDING` |
| T002 Local prerequisites | `NODE_NPM_GIT_VALIDATED / LOCAL_POSTGRES_PENDING` |
| T003 API baseline | `BUILD_VALIDATED / DB_RUNTIME_PENDING` |
| T004 Database baseline | `STATIC_COMPLETE / DATABASE_EXECUTION_PENDING` |
| T005 Tenant context | `UNIT_VALIDATED / DB_INTEGRATION_PENDING` |
| T006 Authorization | `UNIT_VALIDATED / DB_INTEGRATION_PENDING` |
| T007 Audit foundation | `STATIC_COMPLETE / DATABASE_EXECUTION_PENDING` |
| T008 StorageProvider | `UNIT_VALIDATED / FS+DB_INTEGRATION_PENDING` |
| T009 AI Gateway | `UNIT_VALIDATED / PROVIDER_INTEGRATION_PENDING` |
| T010 Web / Design System | `BUILD_VALIDATED / EXECUTABLE_BROWSER_REVIEW_PENDING` |
| T011 Typed API client | `TYPECHECK_VALIDATED / GENERATION_VALIDATION_PENDING` |
| T012 CI | `NOT STARTED / WAITING FOR PACKAGE-LOCK` |

T010 is not DONE until executable browser screenshots are reviewed against `docs/visual-product-target.md`.

---

# 7. Lockfile policy

`package-lock.json` is the canonical JavaScript lockfile.

The validated Windows clean install has generated the correct local lockfile using:

```text
Node 25.9.x + npm 11.6.x + Dotin Nexus
```

The lockfile is not yet present on `main`. It must be committed from the workstation that produced the successful install before T012 CI can use `npm ci` reproducibly.

Do not manually fabricate or GitHub-edit the lockfile. Do not commit `pnpm-lock.yaml`.

---

# 8. Next real engineering actions

1. Commit and push the validated local `package-lock.json`.
2. Run `npm run dev:web` and review the executable product at `http://localhost:3000/app`.
3. Capture real browser screenshots for the approved target routes and compare them with `docs/visual-product-target.md`.
4. Fix any visual/responsive/RTL gaps found in the executable application.
5. Implement T012 CI with Node 25.9.x, npm 11.6.x, Dotin Nexus connectivity and `npm ci`.
6. Install/configure PostgreSQL 18.x and complete DB/API runtime validation.
7. Start M1 Job → Candidate → Evidence vertical slice and replace development fixtures route-by-route with typed APIs.

No later interview/media milestone should bypass these gates.
