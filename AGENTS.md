# Engineering Instructions

Before implementing a ticket:

1. Read `master.md`.
2. Read `projectstate.md`.
3. Read `docs/architecture-decisions/ADR-0002-node-25-npm-runtime.md` for the active Node.js/npm baseline.
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
- Active runtime baseline is Node.js `>=25.9.0 <26` with npm `>=11.6.2 <12`.
- npm workspaces + Turborepo are the active monorepo package/task model. Do not reintroduce pnpm/Yarn/Bun without a new architecture decision.
- NestJS 12 runtime is retained, but Nest CLI/schematics are excluded while their dependency chain rejects Node 25. Use TypeScript compiler-based build/watch tooling.
- Use `StorageProvider`; local development uses the filesystem adapter.
- All npm dependency resolution for this repository must use `https://nexus3.dotin.ir/repository/Dotin-NPM/` through the committed root `.npmrc`. Do not bypass it with the public npm registry during normal project development.
- Never commit Nexus credentials, npm tokens, `_auth`, `_authToken`, passwords, or other package-registry secrets.
- Root `scarfSettings.enabled=false` is intentional; do not silently re-enable install analytics.
- `package-lock.json` is the canonical JavaScript dependency lockfile. Do not commit `pnpm-lock.yaml`.
- Every workspace must have a valid semantic `version`, a unique `@interview/*` name, and exact versions for internal workspace dependencies. Keep `npm run workspace:check` green.
- `npm run install:clean` is only for recovering a stale local dependency graph/lockfile after verified manifest changes; do not use repeated deletion to conceal a reproducible dependency failure.

Visual implementation rules:

- Do not mark a route complete because it has a page title, card, route, or empty state.
- Internal product UI must meet the enterprise information-density target in `docs/visual-product-target.md`.
- Use real React/Next components. Generated mock images do not count as implementation.
- Deterministic fixtures are permitted before domain APIs exist, but must be clearly development-only and replaced during the relevant vertical slice.
- Keep layout primitives RTL/LTR capable; prefer logical CSS properties (`start/end`, `ps/pe`, `border-e`) over hard-coded left/right where direction matters.
- A UI ticket cannot be DONE until executable browser screenshots are reviewed against the approved target.

Validation rules:

- Never claim install/lint/typecheck/test/build/migration success unless the command actually ran successfully.
- When execution is unavailable, record `*_VALIDATION_PENDING` rather than `DONE`.
- Verify `node -v` satisfies `>=25.9.0 <26` and `npm -v` satisfies `>=11.6.2 <12` on the active workstation.
- Run `npm run registry:check` and `npm run workspace:check` before dependency-sensitive validation on a new workstation or after package-manifest changes.
- `npm run workstation:check` validates the JavaScript workstation only (Node/npm/Git). PostgreSQL readiness is a separate `npm run db:check` gate and must not block frontend/static validation.
- Before completing a validated change run the available lint, typecheck, tests and build for the changed scope.
