# Interview Platform

Enterprise AI Recruiter for job definition, sourcing, screening, adaptive interviews, evidence-backed evaluation, shortlist generation and human hiring decisions.

## Source of truth

- `master.md` — architecture contract.
- `projectstate.md` — actual execution status.
- `production-readiness.md` — autonomous interview release gates.
- `docs/visual-product-target.md` — approved visual implementation target.
- `AGENTS.md` — engineering rules.

## Development baseline

Laptop-first/local-native. Docker, Docker Compose, Kubernetes and MinIO are not required for the current development path.

Required now:

- Node.js 25.9.0
- npm 11.6.2
- Git
- PostgreSQL 18.x
- VS Code (preferred)

The repository is an npm workspaces + Turborepo monorepo. `package.json` is the workspace manifest. `pnpm-workspace.yaml` is intentionally not used.

### Required npm registry

All Node/npm dependency resolution for this repository must use the Dotin Nexus registry committed in `.npmrc`:

```text
https://nexus3.dotin.ir/repository/Dotin-NPM/
```

Do not bypass this registry with `registry.npmjs.org` for normal project development. Authentication secrets, if the Nexus requires them, belong in developer/user-level npm configuration or environment variables and must never be committed.

Verify the effective registry and connectivity before installing dependencies:

```bash
npm run registry:check
```

## First clean install after the npm migration

If this checkout was previously installed with pnpm, remove the old pnpm artifacts before the first npm install:

```powershell
Remove-Item pnpm-lock.yaml -Force -ErrorAction SilentlyContinue
Remove-Item node_modules -Recurse -Force -ErrorAction SilentlyContinue
npm install
```

`package-lock.json` is now the canonical dependency lockfile. Generate it with a successful npm 11.6.2 install against the Dotin Nexus, validate the repository, then commit it.

## Start

```bash
npm run registry:check
npm install
copy .env.example .env
npm run workstation:check
npm run db:check
npm run db:migrate
npm run dev:bootstrap
npm run api:sync
npm run dev
```

Web: `http://localhost:3000`  
API: `http://localhost:4000`  
OpenAPI: `http://localhost:4000/docs`

## Enterprise visual target routes

```text
/app                                      Command Center
/app/jobs                                 Jobs
/app/jobs/new                             AI Job Builder
/app/jobs/senior-backend-engineer         Job Workspace
/app/jobs/senior-backend-engineer/candidates
/app/jobs/senior-backend-engineer/pipeline
/app/candidates                           Candidate Database
/app/candidates/ali-rahimi                Candidate Intelligence
/app/interviews                           Interview Hub
/app/interviews/ali-rahimi                AI Interview Review
```

These surfaces are real Next.js code. Until M1 APIs are implemented they use deterministic development fixtures from `apps/web/lib/demo-data.ts`; those fixtures are not production data.

## Quality gate

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

After starting the application, capture browser screenshots of the target routes and compare them against the approved references. A standalone generated mock image is not accepted as implementation evidence.

Use `NEXT_PUBLIC_DEFAULT_LOCALE=en` or `fa` to review LTR/RTL behavior.

## Node 25 / NestJS note

NestJS 12 runtime remains in use, but Nest CLI/schematics are intentionally excluded from the local toolchain because their current schematics dependency chain does not support Node 25. API build and watch use the TypeScript compiler directly, preserving decorator metadata and avoiding a hidden Node-version conflict.
