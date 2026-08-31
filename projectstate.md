# AI Recruiter Platform — PROJECT STATE

> **Status:** M0 JavaScript foundation validated on Windows; second executable visual review completed; visual iteration 2 pushed and awaiting re-validation; database validation pending  
> **Version:** 0.9.6  
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
Last pre-visual lint                      ✅ SUCCESS
Last pre-visual typecheck                 ✅ SUCCESS
Last pre-visual API tests                 ✅ 16/16 PASS
Last pre-visual production build          ✅ SUCCESS
Last pre-visual Next.js generation        ✅ 20/20 STATIC PAGES
Executable browser review 1               ✅ REVIEWED / MAJOR GAPS FOUND
Visual iteration 1                        ✅ PUSHED / RE-REVIEWED
Executable browser review 2               ✅ /app, /app/jobs, /app/candidates REVIEWED
Visual iteration 2                        ✅ SIDEBAR VIEWPORT FIX PUSHED / RE-VALIDATION PENDING
Visual acceptance                         ⚠️ NOT YET COMPLETE
package-lock.json                         🟡 GENERATED LOCALLY / COMMIT PENDING
PostgreSQL client                         ⏳ NOT INSTALLED / DB VALIDATION PENDING
T012 CI                                   ⏳ AFTER CANONICAL LOCKFILE
M1 domain vertical slice                  ⬜ NOT STARTED
Production approval                       ⬜ NOT APPROVED
```

The active JavaScript baseline remains `Node.js >=25.9.0 <26` with `npm >=11.6.2 <12`, npm workspaces, Turborepo, and the required Dotin Nexus registry. ADR-0002 supersedes ADR-0001.

The last full JavaScript quality gate passed on the Windows workstation before the visual iterations. Because visual iteration 2 changes executable web code, the latest `main` must be linted, typechecked, tested and built again before those checks are attributed to the new HEAD.

---

# 2. Validated workstation evidence

```text
Node.js     v25.9.0
npm         11.6.2
Git         2.53.0.windows.3
Registry    https://nexus3.dotin.ir/repository/Dotin-NPM/
```

Dotin Nexus validation succeeded and resolved `@eslint/js 10.0.1`. A clean npm recovery removed stale root/workspace dependency trees and installed 320 packages. The workspace checker validated all 8 npm workspace manifests and exact internal `@interview/*` versions.

---

# 3. Last validated JavaScript quality gate

Before the visual iterations, the workstation reported:

```text
npm run lint       -> 5/5 tasks successful
npm run typecheck  -> 5/5 tasks successful
npm run test       -> 16 tests, 16 pass, 0 fail
npm run build      -> API TypeScript build + Next.js production build successful
Next.js            -> 20/20 static pages generated
```

These results remain valid evidence for the foundation/toolchain, but the modified web HEAD requires a fresh quality-gate run.

---

# 4. Executable visual reviews

## Review 1

Real browser screenshots for `/app`, `/app/jobs`, and `/app/candidates` proved the product was executing but exposed material visual problems:

- Persian/RTL shell mixed with English fixture content and reversed reading hierarchy;
- no active-route state in the sidebar;
- typography and table density were too small;
- fixture notice was too prominent;
- metric cards, page headers, toolbars and topbar needed stronger hierarchy.

Visual iteration 1 addressed those issues by making English/LTR the default fixture presentation, keeping explicit Persian support behind `NEXT_PUBLIC_DEFAULT_LOCALE=fa`, adding active navigation, refining shell spacing/actions, increasing table/readability density, and improving the three reviewed routes.

## Review 2

Fresh executable screenshots for the same three routes showed a substantial improvement:

- English/LTR hierarchy and table reading order are now correct;
- active route state is clear;
- topbar search/actions and page headers read as one enterprise shell;
- Jobs and Candidates tables are materially more legible;
- Command Center information hierarchy is much closer to the approved target.

One concrete shell defect remained at the captured desktop height: the fixed profile card at the bottom of the sidebar overlapped the `Settings` navigation row. Visual iteration 2 fixes this structurally rather than hiding an item: the sidebar is now a flex column, navigation owns a bounded scroll region, the profile card participates in layout, and nav rows are slightly tightened for shorter desktop viewports.

Visual acceptance is still not complete because the new HEAD requires fresh quality validation, the sidebar fix needs an executable re-check, and the remaining approved product surfaces still need browser review.

---

# 5. Source of truth

- `master.md` — stable product and architecture contract including Node 25/npm workspaces.
- `docs/architecture-decisions/ADR-0002-node-25-npm-runtime.md` — active runtime/package-manager decision.
- `projectstate.md` — actual execution status.
- `production-readiness.md` — autonomous interview release gates.
- `AGENTS.md` — implementation rules.
- `docs/visual-product-target.md` — visual implementation acceptance contract.

---

# 6. Workstation vs database prerequisites

The JavaScript workstation is validated. PostgreSQL remains intentionally separate. Missing `psql` does not invalidate frontend lint/typecheck/test/build, but PostgreSQL 18.x is still required before migrations, tenant/RBAC persistence, API persistence and full-stack M0 validation are complete.

Later database sequence:

```powershell
Copy-Item .env.example .env -Force
npm run db:check
npm run db:migrate
npm run dev:bootstrap
npm run api:sync
npm run dev
```

---

# 7. T001–T012 actual status

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
| T010 Web / Design System | `EXECUTABLE_REVIEW_2_COMPLETE / VISUAL_ITERATION_2_REVALIDATION_PENDING` |
| T011 Typed API client | `TYPECHECK_VALIDATED / GENERATION_VALIDATION_PENDING` |
| T012 CI | `NOT STARTED / WAITING FOR PACKAGE-LOCK` |

---

# 8. Lockfile policy

`package-lock.json` is the canonical JavaScript lockfile. The validated Windows install generated it using Node 25.9.x + npm 11.6.x + Dotin Nexus, but it is not yet present on `main`.

Commit the real workstation-generated lockfile; do not fabricate or GitHub-edit it, and do not commit `pnpm-lock.yaml`.

---

# 9. Next real engineering actions

1. Pull visual iteration 2.
2. Re-run `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` against the new HEAD.
3. Run `npm run dev:web` and confirm the sidebar profile card no longer overlaps `Settings` at the same viewport height.
4. Continue browser review with `/app/jobs/senior-backend-engineer`, `/app/jobs/new`, `/app/candidates/ali-rahimi`, and `/app/interviews/ali-rahimi`.
5. Commit and push the validated local `package-lock.json`.
6. Implement T012 CI with Node 25.9.x, npm 11.6.x, Dotin Nexus connectivity and `npm ci`.
7. Install/configure PostgreSQL 18.x and complete DB/API runtime validation.
8. Start M1 Job → Candidate → Evidence vertical slice and replace fixtures route-by-route with typed APIs.

No later interview/media milestone should bypass these gates.
