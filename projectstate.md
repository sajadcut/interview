# AI Recruiter Platform — PROJECT STATE

> **Status:** M0 JavaScript foundation validated on Windows; first executable visual review completed; visual iteration 1 pushed and awaiting re-validation; database validation pending  
> **Version:** 0.9.5  
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
Last pre-visual lint                       ✅ SUCCESS
Last pre-visual typecheck                  ✅ SUCCESS
Last pre-visual API tests                  ✅ 16/16 PASS
Last pre-visual production build           ✅ SUCCESS
Last pre-visual Next.js generation         ✅ 20/20 STATIC PAGES
First executable browser review            ✅ /app, /app/jobs, /app/candidates REVIEWED
Visual acceptance                          ⚠️ NOT ACCEPTED — GAPS FOUND
Visual iteration 1                         ✅ PUSHED TO MAIN / RE-VALIDATION PENDING
package-lock.json                          🟡 GENERATED LOCALLY / COMMIT PENDING
PostgreSQL client                          ⏳ NOT INSTALLED / DB VALIDATION PENDING
T012 CI                                    ⏳ AFTER CANONICAL LOCKFILE
M1 domain vertical slice                   ⬜ NOT STARTED
Production approval                        ⬜ NOT APPROVED
```

The active JavaScript baseline remains `Node.js >=25.9.0 <26` with `npm >=11.6.2 <12`, npm workspaces, Turborepo, and the required Dotin Nexus registry. ADR-0002 supersedes ADR-0001.

The last full JavaScript quality gate passed on the Windows workstation before visual iteration 1. Because visual iteration 1 changes executable web code, the latest `main` must be linted, typechecked, tested and built again before those checks are attributed to the new HEAD.

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

Before visual iteration 1, the workstation reported:

```text
npm run lint       -> 5/5 tasks successful
npm run typecheck  -> 5/5 tasks successful
npm run test       -> 16 tests, 16 pass, 0 fail
npm run build      -> API TypeScript build + Next.js production build successful
Next.js            -> 20/20 static pages generated
```

These results remain valid evidence for the foundation/toolchain, but the modified web HEAD requires a fresh quality-gate run.

---

# 4. First executable visual review

Real browser screenshots were reviewed for:

```text
/app
/app/jobs
/app/candidates
```

They proved the application shell and target routes execute, but did not meet the visual acceptance contract. Shared findings:

- the default Persian/RTL shell was being combined with English fixture content, reversing page hierarchy and table reading order;
- the sidebar lacked active-route state;
- typography and table density were too small at the captured desktop viewport;
- the fixture notice was too visually prominent;
- metric cards, page headers and toolbars needed stronger hierarchy;
- the shell/topbar needed clearer enterprise action structure.

Visual iteration 1 therefore changed shared shell/design primitives plus Command Center, Jobs and Candidates:

- English is now the default fixture locale; `NEXT_PUBLIC_DEFAULT_LOCALE=fa` explicitly enables the Persian shell;
- English fixture-backed main content remains LTR until complete Persian product copy exists;
- active navigation states were added;
- topbar/sidebar spacing and action hierarchy were refined;
- table typography and row density were increased for production readability;
- shared panels, pills, metrics, tabs, avatars and fixture notice were refined;
- `/app`, `/app/jobs`, and `/app/candidates` received route-level hierarchy/table refinements.

No visual route is marked accepted until new executable screenshots are reviewed.

---

# 5. Source of truth

- `master.md` — stable product and architecture contract including Node 25/npm workspaces.
- `docs/architecture-decisions/ADR-0002-node-25-npm-runtime.md` — active runtime/package-manager decision.
- `projectstate.md` — actual execution status.
- `production-readiness.md` — autonomous interview release gates.
- `AGENTS.md` — implementation rules.
- `docs/visual-product-target.md` — visual implementation acceptance contract and first executable review findings.

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
| T010 Web / Design System | `EXECUTABLE_REVIEW_1_COMPLETE / VISUAL_ITERATION_1_REVIEW_PENDING` |
| T011 Typed API client | `TYPECHECK_VALIDATED / GENERATION_VALIDATION_PENDING` |
| T012 CI | `NOT STARTED / WAITING FOR PACKAGE-LOCK` |

---

# 8. Lockfile policy

`package-lock.json` is the canonical JavaScript lockfile. The validated Windows install generated it using Node 25.9.x + npm 11.6.x + Dotin Nexus, but it is not yet present on `main`.

Commit the real workstation-generated lockfile; do not fabricate or GitHub-edit it, and do not commit `pnpm-lock.yaml`.

---

# 9. Next real engineering actions

1. Pull visual iteration 1.
2. Re-run `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` against the new HEAD.
3. Run `npm run dev:web` and capture fresh screenshots for `/app`, `/app/jobs`, and `/app/candidates`.
4. Compare the new executable screenshots against `docs/visual-product-target.md` and continue closing visual gaps.
5. Commit and push the validated local `package-lock.json`.
6. Implement T012 CI with Node 25.9.x, npm 11.6.x, Dotin Nexus connectivity and `npm ci`.
7. Install/configure PostgreSQL 18.x and complete DB/API runtime validation.
8. Start M1 Job → Candidate → Evidence vertical slice and replace fixtures route-by-route with typed APIs.

No later interview/media milestone should bypass these gates.
