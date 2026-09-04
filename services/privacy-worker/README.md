# Privacy Deletion Worker

`services/privacy-worker` is the durable execution driver for approved candidate deletion requests. It is independent of AI, media/realtime and coding-assessment workers.

The worker never receives candidate CV text, transcript text, evidence content, database credentials or object-storage credentials. It leases an approved deletion job through the API's dedicated internal endpoint. The API then executes erasure through the existing tenant-scoped database and `StorageProvider` capability.

Deletion order is intentionally fail-closed:

1. approve a `deletion` privacy request and create one idempotent deletion job;
2. acquire a renewable worker lease;
3. resolve every known candidate-owned file (resume, interview recording, assessment artifact);
4. block deletion when an explicit legal-hold rule or shared object reference applies;
5. delete each Local/S3 object and verify `exists(key) === false`;
6. lock candidate/application/session parents and re-scan for newly attached files;
7. remove candidate-linked CV documents/chunks/embeddings, transcripts, interview/assessment evidence, evaluations, sourcing snapshots and other relational derivatives through explicit cleanup + FK cascades;
8. remove/redact operational JSON records that contain candidate lineage identifiers;
9. remove file metadata only after object erasure is verified;
10. persist a de-identified SHA-256 subject digest, counts and deletion receipt after the candidate row is gone.

The receipt does not retain the source candidate UUID, name, email, phone, CV, transcript or evidence content.

`retention_policies.legal_hold_rules` supports explicit `allCandidates`, `candidateIds` and `applicationIds` holds. Shared storage keys referenced by another candidate block execution rather than risking deletion of another subject's data.

Run locally with the API using the same non-empty secret:

```text
PRIVACY_WORKER_SHARED_SECRET=local-only-secret
PRIVACY_WORKER_API_URL=http://127.0.0.1:4100
npm run privacy-worker:dev
```

The worker uses no package dependencies beyond Node.js. Its unit/syntax checks run with:

```text
npm run privacy-worker:test
```

Production operation still requires storage-provider credentials and backup/replica lifecycle policies to be configured so deleted application objects are not unintentionally retained outside the product's live storage boundary.
