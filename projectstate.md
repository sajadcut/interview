# AI Recruiter Platform — PROJECT STATE

> **Status:** M0 foundation + enterprise visual target implemented statically; Node 25.9/npm 11.6 workspace migration installed successfully on Windows; quality/runtime validation in progress  
> **Version:** 0.9.1  
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
Dotin Nexus npm registry                  ✅ Required / effective on workstation
Nest CLI/schematics Node-25 dependency    ✅ Removed from active toolchain
Clean npm install on Windows              ✅ SUCCESS (320 packages installed)
Registry checker Windows bug              ✅ FIXED IN REPO / RE-RUN PENDING
UI React peer warning                     ✅ FIXED IN REPO / REINSTALL PENDING
package-lock.json                         🟡 GENERATED LOCALLY / VALIDATION+COMMIT PENDING
Lint / typecheck / test / build           ⏳ PENDING
Local PostgreSQL validation               ⏳ PENDING
Executable browser screenshot review      ⏳ PENDING
T012 CI                                   ➡️ NEXT after local validation
M1 domain vertical slice                  ⬜ Not started
Production approval                       ⬜ Not approved
```

The successful workstation install was reported from Windows with Node.js `v25.9.0`, npm `11.6.2`, and the effective registry `https://nexus3.dotin.ir/repository/Dotin-NPM/`. No lint/typecheck/test/build success is claimed yet.

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
- internal workspace dependencies changed from `workspace:*` to npm-compatible version ranges;
- Node type packages aligned to the Node 25 line;
- Nest CLI/schematics removed from the API dev/build path because their current Angular-devkit dependency rejects Node 25;
- API build uses `tsc`; API development watch uses npm CLI + `tsc --watch` plus the compiled Node process;
- npm subprocess invocation now uses `npm_execpath` when available so Windows does not depend on spawning `npm.cmd` directly;
- `@interview/ui` carries a matching React development dependency while retaining React as a peer dependency.

Workstation evidence now shows a successful clean `npm install` against Dotin Nexus. The reported install completed with 320 packages added. Two non-blocking deprecation warnings from `@esbuild-kit/*` remain transitive through existing tooling and are not install failures.

---

# 4. Foundation audit corrections already implemented

The foundation audit found and corrected material gaps in environment loading, database migration execution, tenant/RBAC trust boundaries, tenant-safe storage retrieval, AI structured-output validation, shared UI packaging, and regression-test coverage.

Important constraints remain locked: Candidate organization-global, Application job-specific, Evidence before score, deterministic final score, human consequential decisions, approved sourcing adapters only, provider abstractions, no unsupported biometric/personality inference, and local-native laptop development.

---

# 5. T001–T011 actual status

| Ticket | Actual status |
|---|---|
| T001 Repository bootstrap | `NPM_WORKSPACE_INSTALLED / QUALITY_VALIDATION_PENDING` |
| T002 Local prerequisites | `NODE_NPM_VERIFIED / LOCAL_POSTGRES_PENDING` |
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

On the current Windows workstation:

```powershell
cd D:\interview\interview

git pull
node -v
npm -v
npm config get registry
npm run registry:check
npm install
npm run workstation:check
```

Expected baseline:

```text
Node.js   v25.9.0 or newer 25.x, below 26
npm       11.6.2 or newer 11.x, below 12
registry  https://nexus3.dotin.ir/repository/Dotin-NPM/
```

The clean npm install has already succeeded once on this workstation. Re-run after pulling the latest Windows registry-check and UI peer-dependency fixes so `package-lock.json` reflects the corrected repository state.

Then execute the quality gate:

```powershell
Copy-Item .env.example .env -Force
npm run lint
npm run typecheck
npm run test
npm run build
```

Database/runtime validation follows when local PostgreSQL is available:

```powershell
npm run db:check
npm run db:migrate
npm run dev:bootstrap
npm run api:sync
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

`package-lock.json` is required for reproducible npm CI. It must come from the real Node 25.9/npm 11.6/Dotin Nexus install, not from manual editing.

The workstation has now generated a local lockfile during a successful install. After pulling the latest package metadata fixes, run `npm install` once more and validate lint/typecheck/test/build. Only then commit the resulting `package-lock.json` to `main`.

The old `pnpm-lock.yaml` must not be committed.

---

# 9. Next real engineering action

1. Pull the latest Windows npm-runner and UI peer fixes.
2. Re-run `npm run registry:check` and `npm install`.
3. Execute lint, typecheck, test and build; fix every real failure.
4. Commit the validated `package-lock.json`.
5. Run the application and capture browser screenshots from Next.js.
6. Compare executable screenshots against the approved visual target and close visual gaps.
7. Implement T012 CI using Node 25.9.x + npm 11.6.x and `npm ci`.
8. Start M1 Job → Candidate → Evidence vertical slice and replace development fixtures route-by-route with typed APIs.

No later interview/media milestone should bypass this sequence.
