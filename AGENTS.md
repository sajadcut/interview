# Engineering Instructions

Before implementing a ticket:

1. Read `master.md`.
2. Read `projectstate.md`.
3. Read `production-readiness.md` when the work touches candidate interviews, scoring, security, privacy, or production rollout.
4. Implement only the requested ticket and its explicit prerequisites.
5. Do not violate a LOCKED architecture decision without recording and approving a replacement decision first.

Non-negotiable implementation rules:

- Keep `Candidate` organization-global; job-specific lifecycle belongs to `Application`.
- Evidence precedes consequential scores and recommendations.
- LLMs do not calculate the final weighted hiring score.
- Candidate-facing and internal-company experiences are separate security/UX surfaces.
- AI Interviewer and AI Evaluator are logically separate.
- Avatar/media presentation does not own interview intelligence.
- Do not add mandatory per-minute hosted STT, TTS, avatar, or RTC dependencies.
- Do not add hidden/unapproved scraping as a core sourcing dependency.
- Do not infer personality, honesty, emotion, confidence, or suitability from face/body/accent.
- Tenant boundaries, authorization, audit, consent, and retention are product requirements, not cleanup tasks.
- Current development is laptop-first and local-native; do not introduce Docker/Compose/MinIO as mandatory development prerequisites.
- Use `StorageProvider` abstractions; development storage uses a local filesystem adapter until production object storage is intentionally introduced.
- Install infrastructure/tools only when the active milestone requires them.

Before completing implementation work, run the available lint, typecheck, tests, and build checks for the changed scope. Update `projectstate.md` only when the repository state truly changed.
