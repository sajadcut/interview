# Interview Platform

AI Recruiter platform for job definition, candidate discovery, screening, adaptive AI interviews, evidence-backed evaluation, shortlist generation, and human hiring decisions.

## Source of truth

Read these before making architectural changes:

- `master.md` — stable product and architecture contract.
- `projectstate.md` — current implementation state and engineering tickets.
- `production-readiness.md` — release gates for real-candidate autonomous interviewing.
- `AGENTS.md` — implementation rules for humans and coding agents.

## Repository layout

```text
apps/web                 Next.js company/candidate web surfaces
apps/api                 NestJS core API
services/ai-worker       AI/evaluation worker boundary (placeholder in T001)
services/media-worker    realtime speech/avatar worker boundary (placeholder in T001)
packages/ui              shared product UI package
packages/db              database package boundary
packages/types           shared domain types
packages/validation      shared validation contracts
packages/config          shared configuration contracts
packages/api-client      generated/typed API client boundary
infra/docker             container assets
infra/compose            local compose assets
```

## Prerequisites

- Node.js 24 LTS
- pnpm 11

## Local bootstrap

```bash
pnpm install
pnpm dev
```

Web: `http://localhost:3000`  
API: `http://localhost:4000`

## Quality commands

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm format
```

Infrastructure is intentionally deferred to T002. Authentication, database, RBAC, audit, AI gateway, and the production design system are not part of T001.
