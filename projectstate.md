# AI Recruiter Platform — PROJECT STATE

> **Status:** M0 foundation + enterprise visual target implemented statically; Node 25.9/npm 11.6 workspace migration completed in repository; local runtime validation pending  
> **Version:** 0.9.0  
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
Node.js 25.9 runtime baseline             ✅ Approved / enforced in repo
npm 11.6 workspaces                       ✅ Migrated in repo
Dotin Nexus npm registry                  ✅ Required / configured
Nest CLI/schematics Node-25 dependency    ✅ Removed from active toolchain
Foundation audit                          ✅ Completed statically
Enterprise visual product target          ✅ Coded on main
Clean npm install                         ⏳ PENDING ON LAPTOP
package-lock.json                         ⏳ PENDING SUCCESSFUL NPM INSTALL
Lint / typecheck / test / build            ⏳ PENDING
Local PostgreSQL validation               ⏳ PENDING
Executable browser screenshot review      ⏳ PENDING
T012 CI                                   ➡️ NEXT after local validation
M1 domain vertical slice                  ⬜ Not started
Production approval                       ⬜ Not approved
```

No install/runtime/build/test success is claimed until commands execute successfully on the development laptop or CI.

The active JavaScript baseline is `Node.js >=25.9.0 <26` with `npm >=11.6.2 <12`, npm workspaces, Turborepo, and the required Dotin Nexus registry. ADR-0002 supersedes ADR-0001.

---

# 2. Source of truth

- `master.md` — stable product and architecture contract; runtime/package-manager baseline is being folded into the current architecture revision.
- `docs/architecture-decisions/ADR-0002-node-25-npm-runtime.md` — active Node.js/npm runtime decision.
- `docs/architecture-decisions/ADR-0001-node-22-14-runtime.md` — historical/superseded runtime decision.
- `projectstate.md` — actual execution status.
- `production-readiness.md` — autonomous-interview release gates.
- `AGENTS.md` — implementation rules.
- `docs/visual-product-target.md` — visual implementation acceptance contract.

---

# 3. Runtime/package-manager migration

Repository-side migration completed:

- root `packageManager` changed to npm 11.6.2;
- root engines changed to Node `>=25.9.0 <26` and npm `>=11.6.2 <12`;
- npm workspaces moved into root `package.json`;
- `pnpm-workspace.yaml` removed;
- `pnpm-lock.yaml` rejected as a canonical artifact;
- `package-lock.json` designated as the canonical JavaScript lockfile;
- all root workspace scripts changed from pnpm filtering to npm workspace commands;
- VS Code tasks changed to npm scripts;
- Dotin Nexus remains mandatory through `.npmrc`;
- Nexus retry/TLS configuration moved to npm-native `.npmrc` settings;
- Scarf install analytics disabled at root;
- internal workspace dependencies changed from `workspace:*` to npm-compatible version ranges;
- Node type packages aligned to the Node 25 line;
- Nest CLI/schematics removed from the API dev/build path because their current Angular-devkit dependency rejects Node 25;
- API build uses `tsc`; API development watch uses `npm exec -- tsc --watch` plus the compiled Node process.

A clean npm install is still required on the workstation because existing `node_modules` and `pnpm-lock.yaml` were created under the previous package-manager/runtime baseline.

---

# 4. Foundation audit corrections already implemented

The foundation audit found and corrected material gaps in environment loading, database migration execution, tenant/RBAC trust boundaries, tenant-safe storage retrieval, AI structured-output validation, shared UI packaging, and regression-test coverage.

Important constraints remain locked: Candidate organization-global, Application job-specific, Evidence before score, deterministic final score, human consequential decisions, approved sourcing adapters only, provider abstractions, no unsupported biometric/personality inference, and local-native laptop development.

---

# 5. T001–T011 actual status

| Ticket | Actual status |
|---|---|
| T001 Repository bootstrap | `NPM_WORKSPACE_MIGRATED / CLEAN_INSTALL_PENDING` |
| T002 Local prerequisites | `REPO_COMPLETE / LOCAL_POSTGRES_PENDING` |
| T003 API baseline | `STATIC_COMPLETE / NODE25_RUNTIME_VALIDATION_PENDING` |
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

# 6. Coded visual surfaces

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

The visual pages currently use deterministic development fixtures. This is real React/Next code, not a generated screenshot, but the data is not yet domain-persisted.

---

# 7. Local validation gate

Run after pulling `main` on the Node 25.9.0 / npm 11.6.2 workstation.

Because the checkout was previously installed with pnpm, first clean old package-manager artifacts:

```powershell
cd D:\interview\interview

git pull
Remove-Item pnpm-lock.yaml -Force -ErrorAction SilentlyContinue
Remove-Item node_modules -Recurse -Force -ErrorAction SilentlyContinue

node -v
npm -v
npm config get registry
npm run registry:check
npm cache verify
npm install
```

Expected baseline:

```text
Node.js   v25.9.0 or newer 25.x, below 26
npm       11.6.2 or newer 11.x, below 12
registry  https://nexus3.dotin.ir/repository/Dotin-NPM/
```

After install succeeds:

```powershell
Copy-Item .env.example .env -Force
npm run workstation:check
npm run db:check
npm run db:migrate
npm run dev:bootstrap
npm run api:sync
npm run lint
npm run typecheck
npm run test
npm run build
npm run dev
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

# 8. Lockfile policy

`package-lock.json` is required for reproducible npm CI, but it is intentionally not fabricated through GitHub-only editing.

The workstation must generate it through a real successful command:

```text
npm 11.6.2 + Node 25.9.0 + Dotin Nexus → npm install → package-lock.json
```

Only after install and quality validation should `package-lock.json` be committed to `main`. The old local `pnpm-lock.yaml` must not be committed.

---

# 9. Next real engineering action

1. Pull the Node 25/npm migration.
2. Delete local pnpm lockfile and pnpm-created `node_modules`.
3. Run a clean `npm install` against Dotin Nexus.
4. Send/fix every real install, lint, typecheck, test and build failure.
5. Commit the validated `package-lock.json`.
6. Run the application and capture browser screenshots from Next.js.
7. Compare executable screenshots against the approved visual target and close visual gaps.
8. Implement T012 CI using Node 25.9.x + npm 11.6.x and `npm ci`.
9. Start M1 Job → Candidate → Evidence vertical slice and replace development fixtures route-by-route with typed APIs.

No later interview/media milestone should bypass this sequence.
