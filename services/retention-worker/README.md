# Retention Worker

Durable automatic data-retention executor for the Interview platform.

The worker has no direct database or storage credentials. It authenticates to the API with
`RETENTION_WORKER_SHARED_SECRET`, schedules one idempotent cycle per UTC day, leases tenant-scoped
retention jobs, heartbeats ownership, and reports retryable failures.

Safety properties:

- `RETENTION_WORKER_DRY_RUN=true` by default. Set it explicitly to `false` to permit deletion.
- Only the allowlisted retention entity types are scheduled.
- Operational rows are tenant-scoped and legal-hold-aware.
- Candidate retention never deletes a candidate directly. It creates an approved system privacy
  request and delegates erasure to `privacy-worker`, which deletes database-derived data and
  external objects with absence verification.
- Candidate records with active/unknown application state, recent recruiting activity, privacy
  work in progress, or canonical legal holds fail closed.
- Cycle keys and candidate delegation links are idempotent.
- Worker jobs use leases, heartbeats, bounded retries, and persisted per-policy execution evidence.

Run locally:

```bash
RETENTION_WORKER_SHARED_SECRET=local-secret npm run retention-worker:dev
```

Keep `PRIVACY_WORKER_SHARED_SECRET` and the privacy worker configured as well when candidate
retention is enabled, because verified candidate erasure is intentionally delegated to that worker.
