# Database Migration Runbook

> Scope: production-safe operation of the repository's forward-only PostgreSQL migrations.

## Invariants

- Migrations in `packages/db/migrations` are append-only after they have been applied anywhere outside disposable development databases.
- The migration runner records SHA-256 checksums in `_interview_schema_migrations` and rejects edited historical migrations.
- Only one runner may apply schema changes at a time; the runner holds the `interview-schema-migrations` PostgreSQL advisory lock.
- Every migration is executed in a transaction together with its migration-ledger insert.
- Tenant-scoped foreign-key and sequencing contracts must pass `npm run db:validate` before deployment.
- Dependencies and the committed lockfile are resolved from the public npm registry; production database recovery never depends on a package-registry fallback.

## Pre-deploy procedure

1. Confirm the target commit has a green `quality-gate` including migrations, OpenAPI/client generation, lint, typecheck, tests, and build.
2. Take a database backup or snapshot appropriate to the deployment environment and verify that the backup is readable or restorable in a non-production target.
3. Record the current application commit SHA and the latest row in `_interview_schema_migrations`.
4. Run `npm run db:validate` from exactly the release commit.
5. Apply with `DATABASE_URL=<target> npm run db:migrate` from exactly the release commit.
6. Re-run the migration command once. A healthy second run must report every migration as `skip` and apply nothing.
7. Run liveness and database-readiness checks and a tenant-isolation smoke test before admitting normal traffic.

## Schema-change strategy

Use expand/contract changes whenever application versions may overlap:

1. **Expand:** add nullable columns, new tables/indexes, or compatibility paths without removing behavior used by the currently deployed application.
2. **Migrate/backfill:** move data in bounded, observable steps where necessary.
3. **Switch:** deploy application code that reads/writes the new shape while remaining compatible with the expanded schema.
4. **Contract:** only in a later release remove obsolete schema after rollback windows and old application versions have expired.

Large table rewrites, blocking DDL, destructive column changes, and irreversible data transformations require an explicit deployment plan and measured staging rehearsal before production.

## Rollback policy

This repository intentionally does not implement automatic `down` migrations. Destructive reverse DDL is unsafe for tenant data and can make an incident worse.

Use one of these recovery paths:

### Application-only rollback

When the schema change is backward compatible, redeploy the previous application commit while leaving the forward schema in place. Follow with a corrective forward migration if needed.

### Corrective forward migration

For a schema defect that does not require restoring lost data, create a new numbered migration that repairs the schema/data. Never edit the already-applied migration.

### Database restore

For destructive or unrecoverable data/schema failures:

1. Stop writes or place the service in maintenance mode.
2. Capture the failed database state for incident analysis if feasible.
3. Restore the verified pre-deploy backup/snapshot into a new database or according to the platform recovery procedure.
4. Run migration-ledger, referential-integrity, tenant-isolation, and application-readiness checks against the restored target.
5. Point the application at the restored database only after those checks pass.
6. Reconcile any external side effects that occurred after the recovery point.
7. Document the incident and ship a new forward migration before retrying the release.

## Migration verification in CI

The GitHub Actions quality gate provisions PostgreSQL 18, validates migration contracts, applies every committed migration from a clean database, regenerates OpenAPI and the typed client, then runs lint, typecheck, PostgreSQL/unit tests, and build. A migration that cannot initialize a clean database therefore blocks the release before application deployment.

## Required release evidence

Retain the release commit SHA, backup/snapshot identifier, migration runner output, schema migration ledger state, readiness result, and tenant-isolation smoke-test result with the deployment record.
