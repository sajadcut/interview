# Database Migration Runbook

> Scope: production-safe operation of the repository's forward-only PostgreSQL migrations.

## Invariants

- Migrations in `packages/db/migrations` are append-only after they have been applied anywhere outside disposable development databases.
- The migration runner records SHA-256 checksums in `_interview_schema_migrations` and rejects edited historical migrations.
- Only one runner may apply schema changes at a time; the runner holds the `interview-schema-migrations` PostgreSQL advisory lock.
- Every migration is executed in a transaction together with its migration-ledger insert.
- Tenant-scoped foreign-key and sequencing contracts must pass `npm run db:validate` before deployment.

## Pre-deploy procedure

1. Confirm the target commit has a green quality gate.
2. Run `npm run registry:check` from the repository root and confirm the mandatory Dotin Nexus registry can serve all critical packages.
3. Take a database backup/snapshot appropriate to the deployment environment and verify that the backup is readable.
4. Record the current application commit SHA and the latest row in `_interview_schema_migrations`.
5. Run `npm run db:validate` against the repository checkout.
6. Apply with `DATABASE_URL=<target> npm run db:migrate` from exactly the release commit.
7. Re-run the migration command once. A healthy second run must report every migration as `skip` and apply nothing.
8. Run application health/readiness checks and a tenant-isolation smoke test before admitting normal traffic.

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
4. Point the application at the restored database only after integrity checks pass.
5. Reconcile any external side effects that occurred after the backup point.
6. Document the incident and ship a new forward migration before retrying the release.

## Required release evidence

Retain the release commit SHA, backup/snapshot identifier, migration runner output, schema migration ledger state, health-check result, and tenant-isolation smoke-test result with the deployment record.
