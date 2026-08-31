# Engineering Instructions

Before implementing a ticket:

1. Read `master.md`.
2. Read `projectstate.md`.
3. Read `docs/architecture-decisions/ADR-0001-node-22-14-runtime.md` for the active Node.js runtime baseline.
4. Read `docs/visual-product-target.md` for internal recruiter UI work.
5. Read `production-readiness.md` when work touches interviews, scoring, security, privacy, or rollout.
6. Implement only the requested scope and explicit prerequisites.

Non-negotiable architecture rules:

- Keep `Candidate` organization-global; job-specific lifecycle belongs to `Application`.
- Evidence precedes consequential scores and recommendations.
- LLMs do not calculate the final weighted hiring score.
- Candidate-facing and internal-company experiences are separate security/UX surfaces.
- AI Interviewer and AI Evaluator are logically separate.
- Avatar/media presentation does not own interview intelligence.
- Do not add mandatory hosted STT/TTS/avatar/RTC dependencies.
- Do not add hidden/unapproved scraping as a core sourcing dependency.
- Do not infer personality, honesty, emotion, confidence, or suitability from face/body/accent.
- Tenant boundaries, authorization, audit, consent, and retention are foundation requirements.
- Current development is laptop-first/local-native; Docker/Compose/MinIO are not mandatory dev prerequisites.
- Active Node.js baseline is `>=22.14.0 <23` per ADR-0001. Do not reintroduce a Node 24-only requirement without a new architecture decision and validation.
- Use `StorageProvider`; local development uses the filesystem adapter.
- All pnpm/npm dependency resolution for this repository must use `https://nexus3.dotin.ir/repository/Dotin-NPM/` through the committed root `.npmrc`. Do not bypass it with the public npm registry during normal project development.
- Never commit Nexus credentials, npm tokens, `_auth`, `_authToken`, passwords, or other package-registry secrets.

Visual implementation rules:

- Do not mark a route complete because it has a page title, card, route, or empty state.
- Internal product UI must meet the enterprise information-density target in `docs/visual-product-target.md`.
- Use real React/Next components. Generated mock images do not count as implementation.
- Deterministic fixtures are permitted before domain APIs exist, but must be clearly development-only and replaced during the relevant vertical slice.
- Keep layout primitives RTL/LTR capable; prefer logical CSS properties (`start/end`, `ps/pe`, `border-e`) over hard-coded left/right where direction matters.
- A UI ticket cannot be DONE until executable browser screenshots are reviewed against the approved target.

Validation rules:

- Never claim lint/typecheck/test/build/migration success unless the command actually ran successfully.
- When execution is unavailable, record `*_VALIDATION_PENDING` rather than `DONE`.
- Verify `node -v` satisfies `>=22.14.0 <23` and run `pnpm workstation:check` on the active workstation.
- Verify `pnpm registry:check` before dependency installation or dependency-sensitive validation on a new workstation.
- Before completing a validated change run the available lint, typecheck, tests and build for the changed scope.
