# Interview Platform

Enterprise AI Recruiter for job definition, sourcing, screening, adaptive interviews, evidence-backed evaluation, shortlist generation and human hiring decisions.

## Source of truth

- `master.md` — architecture contract.
- `projectstate.md` — actual execution status.
- `production-readiness.md` — autonomous interview release gates.
- `docs/visual-product-target.md` — approved visual implementation target.
- `docs/architecture-decisions/ADR-0001-node-22-14-runtime.md` — approved Node 22.14 runtime decision that supersedes only the Node 24 statements in master v0.4.0.
- `AGENTS.md` — engineering rules.

## Development baseline

Laptop-first/local-native. Docker, Docker Compose, Kubernetes and MinIO are not required for the current development path.

Required: Node.js 22.14.0 or newer 22.x (`>=22.14.0 <23`), pnpm 11, Git, PostgreSQL 18.x and preferably VS Code.

### Required npm registry

All Node/pnpm dependency resolution for this repository must use the Dotin Nexus registry committed in `.npmrc`:

```text
https://nexus3.dotin.ir/repository/Dotin-NPM/
```

Do not bypass this registry with `registry.npmjs.org` for normal project development. Authentication secrets, if the Nexus requires them, belong in developer/user-level npm configuration or environment variables and must never be committed.

Verify the effective registry and connectivity before installing dependencies:

```bash
pnpm registry:check
```

## Start

```bash
pnpm registry:check
pnpm install
cp .env.example .env
pnpm workstation:check
pnpm db:check
pnpm db:migrate
pnpm dev:bootstrap
pnpm api:sync
pnpm dev
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
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

After starting the application, capture browser screenshots of the target routes and compare them against the approved references. A standalone generated mock image is not accepted as implementation evidence.

Use `NEXT_PUBLIC_DEFAULT_LOCALE=en` or `fa` to review LTR/RTL behavior.
