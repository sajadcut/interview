# AI Recruiter Platform — PROJECT STATE

> **Status:** M0 foundation + enterprise visual target implemented statically; Node 25.9/npm 11.6 workspace migration active; npm lock recovery added; quality/runtime validation in progress  
> **Version:** 0.9.2  
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
Dotin Nexus npm registry                  ✅ Required / verified on workstation
Nest CLI/schematics Node-25 dependency    ✅ Removed from active toolchain
Initial clean npm install on Windows      ✅ SUCCESS (320 packages installed)
Registry checker Windows bug              ✅ FIXED / RE-RUN SUCCESSFUL
Workspace metadata checker                ✅ ADDED
Stale npm lock recovery                   ✅ ADDED (`npm run install:clean`)
Second npm reconciliation                 ⚠️ STALE LOCAL LOCK FAILED (`Invalid Version:`)
JavaScript workstation check              ✅ NODE/NPM/GIT VERIFIED
PostgreSQL client                         ⏳ NOT INSTALLED / DB VALIDATION PENDING
package-lock.json                         🟡 REGENERATION REQUIRED
Lint / typecheck / test / build           ⏳ PENDING
Executable browser screenshot review      ⏳ PENDING
T012 CI                                   ➡️ NEXT after local validation
M1 domain vertical slice                  ⬜ Not started
Production approval                       ⬜ Not approved
```

Workstation evidence confirms Node.js `v25.9.0`, npm `11.6.2`, Git, and the effective registry `https://nexus3.dotin.ir/repository/Dotin-NPM/`. `npm run registry:check` now succeeds against Dotin Nexus.

The first npm install after migration completed successfully with 320 packages. A later `npm install` after the UI React peer metadata changed failed with bare `Invalid Version:`. The prior install log had recorded `react@undefined` for the UI peer state, so the repository now treats the local lock/tree as stale and provides an explicit clean-install recovery path. No lint/typecheck/test/build success is claimed yet.

The active JavaScript baseline is `Node.js >=25.9.0 <26` with `npm >=11.6.2 <12`, npm workspaces, Turborepo, and the required Dotin Nexus registry. ADR-0002 supersedes ADR-0001.

---

# 2. Source of truth

- `master.md` — stable product and architecture contract including the active Node 25/npm workspace baseline.
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
- Nexus retry/TLS configuration uses npm-native `.npmrc` settings;
- Scarf install analytics disabled at root;
- internal workspace dependencies use npm-compatible exact workspace versions;
- Node type packages aligned to the Node 25 line;
- Nest CLI/schematics removed from the API dev/build path because their current Angular-devkit dependency rejects Node 25;
- API build uses `tsc`; API development watch uses npm CLI + `tsc --watch` plus the compiled Node process;
- npm subprocess invocation uses `npm_execpath` when available so Windows does not depend on directly spawning `npm.cmd`;
- `@interview/ui` carries a matching React development dependency while retaining React as a peer dependency;
- `scripts/check-workspaces.mjs` validates all workspace package names, semantic versions, and internal dependency version alignment;
- `npm run install:clean` validates workspace metadata, removes stale local `node_modules` and `package-lock.json`, and performs a fresh install against Dotin Nexus.

The clean-install command is a recovery mechanism for stale local dependency graphs, not a substitute for fixing a reproducible dependency error.

---

# 4. Workstation vs database prerequisites

`npm run workstation:check` now validates only the JavaScript development workstation:

```text
Node.js
npm
Git
```

PostgreSQL is intentionally checked separately by `npm run db:check`. This prevents missing `psql` from blocking frontend visual work, lint, typecheck, tests, or build.

PostgreSQL 18.x remains required for database/API persistence validation before M0 can be considered fully runtime-validated.

---

# 5. T001–T011 actual status

| Ticket | Actual status |
|---|---|
| T001 Repository bootstrap | `NPM_WORKSPACE_MIGRATED / LOCK_REGENERATION_PENDING` |
| T002 Local prerequisites | `NODE_NPM_GIT_VERIFIED / LOCAL_POSTGRES_PENDING` |
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

# 7. Current local validation sequence

On the current Windows workstation:

```powershell
cd D:\interview\interview

git pull
node -v
npm -v
npm config get registry
npm run registry:check
npm run workspace:check
npm run install:clean
npm run workstation:check
```

Expected baseline:

```text
Node.js   v25.9.0 or newer 25.x, below 26
npm       11.6.2 or newer 11.x, below 12
registry  https://nexus3.dotin.ir/repository/Dotin-NPM/
```

After the clean install succeeds, execute the quality gate without waiting for PostgreSQL:

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
```

Frontend visual review can then start with:

```powershell
npm run dev:web
```

Database/runtime validation follows after local PostgreSQL is installed and configured:

```powershell
Copy-Item .env.example .env -Force
npm run db:check
npm run db:migrate
npm run dev:bootstrap
npm run api:sync
npm run dev
```

Then review desktop screenshots for the approved visual target routes and repeat with `NEXT_PUBLIC_DEFAULT_LOCALE=fa` and `en`.

Any failure reopens the relevant ticket.

---

# 8. Lockfile policy

`package-lock.json` is required for reproducible npm CI. It must come from the real Node 25.9/npm 11.6/Dotin Nexus install, not from manual editing.

The currently generated local lockfile must be discarded because npm later failed to reconcile it after workspace peer metadata changed. `npm run install:clean` is the canonical one-time recovery for this state.

After a fresh install succeeds and lint/typecheck/test/build pass, commit the resulting `package-lock.json` to `main`. The old `pnpm-lock.yaml` must not be committed.

---

# 9. Next real engineering action

1. Pull the workspace-check / clean-install / workstation-check fixes.
2. Run `npm run workspace:check`.
3. Run `npm run install:clean` to regenerate the dependency graph and lockfile from Dotin Nexus.
4. Execute lint, typecheck, test and build; fix every real failure.
5. Commit the validated `package-lock.json`.
6. Run `npm run dev:web` and capture browser screenshots from Next.js even before PostgreSQL is installed.
7. Compare executable screenshots against the approved visual target and close visual gaps.
8. Install/configure PostgreSQL and complete DB/API validation.
9. Implement T012 CI using Node 25.9.x + npm 11.6.x and `npm ci`.
10. Start M1 Job → Candidate → Evidence vertical slice and replace development fixtures route-by-route with typed APIs.

No later interview/media milestone should bypass this sequence.
