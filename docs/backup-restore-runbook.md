# Backup and Restore Runbook

This runbook defines the database backup/restore procedure for the interview platform. Schema rollback is not performed by editing or deleting already-applied migrations. Application rollback uses expand/contract compatibility, while destructive recovery uses a verified PostgreSQL backup.

## Scope

Back up at minimum:

- PostgreSQL application database, including `_interview_schema_migrations`.
- S3-compatible object storage referenced by `files` and interview recording/file metadata.
- Deployment configuration and secret references (never secret plaintext in the repository).

A database backup is not considered usable until a restore verification has succeeded in an isolated environment.

## Preconditions

Use PostgreSQL client tools compatible with the production major version. The commands below expect `DATABASE_URL` and `RESTORE_DATABASE_URL` to be provided through the deployment secret manager.

Never pass production credentials in shell history, source control, CI logs, tickets, or chat.

## Create a database backup

Use the PostgreSQL custom format because it supports selective inspection, parallel restore, and integrity checks:

```bash
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="interview-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Record outside the database:

- UTC creation timestamp.
- database/server version.
- application commit SHA.
- latest row from `_interview_schema_migrations`.
- SHA-256 of the dump file.
- object-storage backup/snapshot reference covering the same recovery point.

Example checksum:

```bash
sha256sum interview-*.dump
```

## Verify a backup before declaring it valid

At minimum, confirm that the archive can be listed:

```bash
pg_restore --list interview-YYYYMMDDTHHMMSSZ.dump > restore.list
```

A valid production backup must also complete the isolated restore drill below.

## Isolated restore drill

Create an empty disposable PostgreSQL database. It must never point to production.

```bash
pg_restore "$RESTORE_DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  interview-YYYYMMDDTHHMMSSZ.dump
```

Then run repository verification against the restored database:

```bash
DATABASE_URL="$RESTORE_DATABASE_URL" npm run db:migrate
DATABASE_URL="$RESTORE_DATABASE_URL" npm run db:performance
```

`db:migrate` must report existing migrations as `skip` and must not report checksum drift. `db:performance` must report all required operational indexes present, valid, and ready.

Validate critical data relationships with read-only checks appropriate to the environment, including:

- organizations and users exist as expected;
- tenant-scoped candidates/applications do not cross organization boundaries;
- `_interview_schema_migrations` is present;
- audit events are readable;
- file metadata points only to expected object-storage keys;
- privacy/legal-hold records are present.

## Object-storage recovery

The database and S3-compatible object storage must use coordinated recovery points. Recovery procedure:

1. Freeze destructive lifecycle jobs (`retention`, `privacy_deletion`, `session_cleanup`) during recovery.
2. Restore the PostgreSQL database to the selected recovery point.
3. Restore/version-recover the object-storage bucket to the matching point.
4. Verify representative `files.storage_key` objects exist in the restored bucket.
5. Keep the application unavailable until database and object-storage verification both pass.

Do not silently recreate missing evidence or interview media objects. Missing objects are an integrity incident and must be surfaced explicitly.

## Application rollback strategy

For ordinary bad releases, prefer application rollback over database restore:

1. Stop traffic to the faulty application version.
2. Deploy the previous known-good application version only if the deployed schema remains backward compatible.
3. Do not delete rows from `_interview_schema_migrations` and do not edit an applied migration.
4. Correct schema/data defects with a new forward migration.
5. Use backup restore only when forward correction cannot safely recover the required state.

All schema changes should therefore follow expand/contract:

- expand: additive columns/tables/indexes and compatible writes;
- migrate/backfill: move data while old and new versions remain compatible;
- contract: remove old structures only after no supported application version depends on them.

## Disaster recovery decision gate

A production restore requires an incident owner and explicit recorded approval. Before restore, capture:

- incident identifier and reason;
- selected recovery point and expected data-loss window;
- backup checksum;
- object-storage recovery point;
- application commit to deploy after restore;
- approver and operator identities.

After restore, capture verification evidence and the actual recovery point achieved.

## Required recurring drill

Run an isolated restore drill on a schedule appropriate to the deployment risk profile and after material database/storage architecture changes. A backup strategy without a successful restore drill is considered unverified.
