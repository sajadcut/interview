# ADR-0003 — PostgreSQL 17.11 local development baseline

> Status: ACCEPTED
> Date: 2026-08-31

## Context

The active Windows development workstation has PostgreSQL 17.11 installed and available locally. The previous architecture baseline referenced PostgreSQL 18.x, but the current product/database schema does not depend on PostgreSQL 18-only features. Continuing to require a different major version would add workstation friction without improving the current M0–M5 implementation path.

## Decision

Use PostgreSQL 17.11 as the active local development database baseline for the current workstation and repository validation path.

```text
PostgreSQL local baseline  17.11
host                       localhost
port                       5432
database                   interview
role                       interview
```

PostgreSQL remains the primary system of record. Drizzle ORM, the checksum migration runner, tenant-isolation constraints, pgcrypto UUID generation, and future pgvector integration remain unchanged.

This ADR supersedes only the previously stated PostgreSQL 18.x local-version requirement. It does not change the product data model, tenancy model, migration policy, production database selection process, or the requirement to validate migrations on the active database.

## Security and secrets

Database passwords stay only in the developer's ignored `.env` or machine-level secret configuration. No password or connection secret is committed to the repository.

## Validation required

Before this baseline is considered database-validated, the workstation must successfully run:

```text
npm run db:check
npm run db:migrate
npm run dev:bootstrap
npm run api:sync
npm run lint
npm run typecheck
npm run test
npm run build
```

Migration and API runtime success must not be claimed until these commands execute successfully on the workstation.
