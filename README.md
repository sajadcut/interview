# Interview Platform

AI Recruiter platform for job definition, candidate discovery, screening, adaptive AI interviews, evidence-backed evaluation, shortlist generation, and human hiring decisions.

## Source of truth

- `master.md` — product and architecture contract.
- `projectstate.md` — current implementation state.
- `production-readiness.md` — release gates for autonomous real-candidate interviews.
- `AGENTS.md` — engineering rules.

## Current development baseline

Laptop-first, local-native development. Docker, Docker Compose, Kubernetes and MinIO are not required.

Required now:

- Node.js 24 LTS
- pnpm 11
- Git
- PostgreSQL 18.x
- VS Code (preferred)

## Start

```bash
pnpm install
cp .env.example .env
pnpm workstation:check
pnpm db:check
pnpm db:migrate
pnpm dev
```

Web: `http://localhost:3000`  
API: `http://localhost:4000`  
OpenAPI UI: `http://localhost:4000/docs`

## Quality

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

## OpenAPI client sync

```bash
pnpm api:sync
```

This exports `openapi/openapi.json` from NestJS and regenerates `packages/api-client/src/generated/schema.ts`.

## Local storage

Development artifacts are stored via `LocalFilesystemStorageAdapter` under `.local-data/storage/`. Production object storage remains behind the same `StorageProvider` interface.

## Implemented foundation

T001–T011 establish the repository, local development baseline, API conventions, PostgreSQL/Drizzle schema, tenant context, RBAC, audit, local storage, AI gateway, web/candidate surfaces, design-system primitives, and the typed OpenAPI client.
