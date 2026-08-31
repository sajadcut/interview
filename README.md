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

Required: Node.js 24 LTS, pnpm 11, Git, PostgreSQL 18.x and preferably VS Code.

## Start

```bash
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
