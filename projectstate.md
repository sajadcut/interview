# AI Recruiter Platform — PROJECT STATE

> **Status:** M0 foundation implemented through T011; local runtime validation pending  
> **Version:** 0.5.0  
> **Date:** 2026-08-31  
> **Repository:** https://github.com/sajadcut/interview  
> **Branch:** `main`

---

# 1. Current state

```text
Product architecture              ✅ Defined
Core technical architecture       ✅ Defined
Interview architecture            ✅ Defined
Self-hosted media constraint       ✅ Locked
Production-readiness gates         ✅ Defined
Laptop-first dev baseline          ✅ Locked
T001 repository bootstrap          ✅ Implemented / merged
T002 local dev prerequisites       ✅ Repo-side setup implemented
T003 API baseline                  ✅ Implemented
T004 database baseline             ✅ Implemented
T005 tenant context                ✅ Implemented
T006 authorization                 ✅ Implemented
T007 audit foundation              ✅ Implemented
T008 local StorageProvider         ✅ Implemented
T009 AI Gateway                    ✅ Implemented
T010 web/design-system shell       ✅ Implemented
T011 typed API client              ✅ Implemented
T012 CI                            ➡️ NEXT
M1 product vertical slice          ⬜ Not started
Calibration                        ⬜ Not started
Shadow evaluation                  ⬜ Not started
Pilot                              ⬜ Not started
Production approval                ⬜ Not approved
```

`T002` includes repository scripts/docs for local PostgreSQL. Installing/running PostgreSQL itself happens on the development laptop and cannot be performed through GitHub.

---

# 2. Source of truth

```text
master.md
→ stable product + architecture contract

projectstate.md
→ current execution state

production-readiness.md
→ release gates for real-candidate autonomous interviews

AGENTS.md
→ implementation constraints for humans and coding agents
```

---

# 3. Locked implementation baseline

- Modular monolith first; specialized AI/media workers remain separate boundaries.
- PostgreSQL is the primary system of record.
- Candidate is organization-global; Job lifecycle is owned by `Application`.
- Evidence precedes consequential scores/recommendations.
- Final weighted scoring remains deterministic domain code.
- Human review/override remains available for consequential employment decisions.
- AI provenance is mandatory through `AIExecution`.
- Provider abstractions are required for LLM, storage, STT, TTS, avatar and media.
- Tenant context and authorization are foundation concerns.
- No hidden/unapproved scraping dependency.
- No unsupported face/body/accent psychological inference.
- Current development is laptop-first with VS Code; Docker/MinIO are deferred.
- Development storage uses `LocalFilesystemStorageAdapter`.
- Realtime interview media must retain a self-hosted production path.

Full architectural decisions remain in `master.md`.

---

# 4. Implemented repository foundation

```text
apps/web
├─ internal company surface `/app`
├─ candidate surface `/candidate`
├─ app shell/navigation
├─ Tailwind design tokens
├─ UI primitives
├─ recruitment-aware components
└─ TanStack Query + typed API client

apps/api
├─ NestJS bootstrap
├─ environment validation
├─ JSON logger
├─ correlation ID
├─ HTTP error envelope
├─ OpenAPI/Swagger
├─ health endpoint
├─ tenant AsyncLocalStorage context
├─ permission guard/decorators
├─ audit service/interceptor
├─ local StorageProvider
├─ database service
└─ AI Gateway

packages/db
├─ Drizzle/PostgreSQL config
├─ organizations/users/memberships
├─ roles/permissions
├─ audit_events
├─ files
├─ ai_executions
└─ SQL migrations 0001–0005

packages/api-client
├─ OpenAPI schema input
├─ generated TypeScript paths
├─ openapi-fetch client
└─ web integration
```

---

# 5. M0 ticket status

| Ticket | Status | Result |
|---|---|---|
| T001 | DONE | pnpm/Turborepo monorepo and app/package boundaries |
| T002 | IMPLEMENTED | workstation checks, local PostgreSQL docs/connectivity script |
| T003 | DONE | Nest API baseline, config, logging, errors, correlation ID, OpenAPI |
| T004 | DONE | Drizzle, PostgreSQL schema, migrations, organization/user/membership |
| T005 | DONE | tenant context and tenant repository guardrails |
| T006 | DONE | roles/permissions model, decorators, guard and unit tests |
| T007 | DONE | AuditEvent persistence model/service/interceptor |
| T008 | DONE | StorageProvider + LocalFilesystemStorageAdapter + metadata |
| T009 | DONE | LLMProvider abstraction + AIExecution provenance + compatible adapter |
| T010 | DONE | internal/candidate surfaces and design-system foundation |
| T011 | DONE | OpenAPI export/generation and TanStack Query typed client |
| T012 | NEXT | GitHub Actions install/lint/typecheck/test/build/migration validation |

---

# 6. Local validation checklist

Run on the development laptop after cloning/pulling `main`:

```bash
pnpm install
cp .env.example .env
pnpm workstation:check
pnpm db:check
pnpm db:migrate
pnpm api:sync
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Any failure here reopens the relevant T001–T011 ticket before M1 implementation proceeds.

---

# 7. Current database migration order

```text
0001_foundation.sql
→ organizations
→ users
→ memberships

0002_authorization.sql
→ roles
→ permissions
→ role_permissions
→ membership_roles

0003_audit.sql
→ audit_events

0004_files.sql
→ files

0005_ai_executions.sql
→ ai_executions
```

pgvector is intentionally deferred until semantic candidate matching is implemented.

---

# 8. Next engineering action

## T012 — CI

Add GitHub Actions for:

```text
pnpm install
lint
typecheck
unit tests
build
OpenAPI/client drift check
migration/schema validation
```

After T012, start M1:

```text
Job
→ Rubric
→ Candidate
→ Resume
→ Application
→ Matching
→ Evidence
→ Pipeline
→ Scorecard
→ Human Review
→ Compare
→ Shortlist
```

---

# 9. Deferred infrastructure

Not required for current laptop development:

```text
Docker
Docker Compose
MinIO
Kubernetes
Temporal
LiveKit
coturn
Redis
pgvector
GPU/avatar runtime
```

These are introduced only when the corresponding product milestone requires them.

---

# 10. Production status

No autonomous interview capability is production-approved yet.

```text
Interview production status: DEV_ONLY
```

Promotion beyond `DEV_ONLY` follows `production-readiness.md` and requires calibration, reliability, security, fairness and pilot gates.
