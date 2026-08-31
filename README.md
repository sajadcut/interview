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
services/ai-worker       AI/evaluation worker boundary
services/media-worker    realtime speech/avatar worker boundary
packages/ui              shared product UI package
packages/db              database package boundary
packages/types           shared domain types
packages/validation      shared validation contracts
packages/config          shared configuration contracts
packages/api-client      generated/typed API client boundary
```

Deployment/container assets are intentionally deferred. They will be added under `infra/` when deployment work actually begins.

## Current development model

Development is laptop-first and local-native. VS Code is the preferred IDE.

Initial prerequisites:

- Git
- Node.js 24 LTS
- pnpm 11
- PostgreSQL installed locally when T002 begins

Tools such as Python, Redis, pgvector, FFmpeg, LiveKit, coturn, whisper.cpp, local TTS, and avatar dependencies are installed only when the relevant milestone needs them.

Docker Desktop, Docker Compose, Kubernetes, and MinIO are **not required for the current development phase**.

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

Local uploaded/test files will eventually use a development `LocalFilesystemStorageAdapter` under `.local-data/`; production object storage remains behind `StorageProvider` and is deferred.

Authentication, database modeling, RBAC, audit, AI gateway, and the production design system are not part of T001.
