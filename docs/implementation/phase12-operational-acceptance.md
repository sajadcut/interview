# Phase 1–2 operational acceptance: supervised sign-off

This is an **execution checklist**, not evidence that the checks have run. Code/CI validation alone MUST NOT be reported as successful real-provider or deployment acceptance. Run only within the organization's approved environment, with a designated HR reviewer, privacy owner and service operator.

## 1. Approved-organization LLM + consent (Phase 1 and Phase 2)

1. Record the approved model endpoint, hosting/data residency, vendor processing terms, access control, retention policy, prompt/response logging policy, and privacy/security approver IDs **outside the repository**. Never paste secrets, applicant personal data, or complete prompts into GitHub logs/issues.
2. Create a dedicated test organization and explicit human consent record for the test resume. Use a volunteer/consented synthetic resume with known offsets, multiple resumes and known positive/negative skill examples. Disable AI extraction by default; use the explicit opt-in action in the Persian UI.
3. Configure `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY` via approved secret management. Confirm TLS certificate chain validity without `NODE_TLS_REJECT_UNAUTHORIZED=0`. Check that disabled, unavailable and timeout cases do **not** trigger a fallback to a public endpoint.
4. Run actual suggestion generation. Assert every returned skill claim belongs to the tenant taxonomy and every UTF-16 span exactly equals the cited resume excerpt. Log only counts, status, timestamps, model versions, SHA-256 digests, and PASS/FAIL (no raw PII); calibrate confidence against human-reviewed reference labels. Invalid spans, false assertions, alias collisions and source SHA mismatch must fail closed.
5. Upload a tenant/job-scoped question file and explicitly authorize up to 6,000 source-text characters for question suggestions. Confirm the model cannot turn embedded instruction text into a privileged command or approve a question. Verify a human reviewer with `job.edit` records an explicit approval/rejection reason; a rejected/draft question must never appear in an application snapshot.
6. Record privacy officer approval, model calibration findings, privacy/data-retention boundaries and a redacted test evidence link before closing the real-provider gate.

## 2. Immutable planning and interview replay (Phase 2)

1. Select up to 8 job-bound question documents for an application and save a snapshot. Ensure the questions map to *current active* job skills and approved immutable question versions.
2. Start a session. Verify `interview_sessions.question_selection_snapshot_id` is pinned to the precise saved application snapshot, and cannot be updated. Test the same candidate on a second job/rubric version and verify no job/tenant/version leakage.
3. In a supervised interview, capture which **approved question version IDs were actually supplied to the LLM** in `interview_turns.question_bank_question_version_ids`. These IDs indicate prompt context, not proof of the candidate's competence or proof that the model asked that exact question. Verify the final spoken turn separately.
4. Disconnect and restart the API/worker, then resume. Ensure immutable selection SHA and cited version IDs do not change. Model-offline fallback must disclose the fallback and must not fabricate skill evidence or a score.
5. Publish a new rubric/question version after the session started: it must not rewrite the session pin or any historical turn. Published application rubric must agree with the interview plan rubric; the database refuses mismatches.
6. Human HR must review the resulting rubric-based score and evidence anchors. Resume assertion, LLM confidence and unanswered skill are never automatically passed/failed.

## 3. Local private disk and deployment volume (Phase 2)

1. Set `STORAGE_PROVIDER=local` and `LOCAL_STORAGE_ROOT` to a private **persistently mounted volume** in staging. Confirm filesystem permissions, backup policy, encryption, quota, lifecycle, and read-only web serving boundaries.
2. Upload a PDF/DOCX/TXT question file through the UI. Record its file ID and metadata hash, not its contents. Confirm the bytes at the private key have the expected SHA-256.
3. Restart API, worker and deployment container(s) while keeping the volume. Verify the original bytes remain addressable via the tenant-scoped storage API, with the same hash. Deny cross-tenant reads.
4. Verify delete/retention propagation and recovery from a read-only/missing volume. A clean CI filesystem-adapter restart test does **not** prove staging volume persistence.
5. Capture redacted PASS/FAIL and deployment evidence; only then mark the staging volume gate signed off.

## Evidence and release decision

Required: exact Git SHA and successful CI URL; human reviewer ID and date; model endpoint approval/reference; offset/confidence calibration report; scoped privacy/consent approval; supervised turn replay report; persistent-volume restart/restore report; failures with issue IDs. Do **not** mark Phase 1 or Phase 2 DONE when any of these external approvals/tests is missing. No automatic promotion to Phases 3–5.
