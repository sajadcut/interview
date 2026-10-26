---
name: interview-quality-gate
description: Verify and safely deliver Interview code changes with repository-specific Node/npm, database migrations, API contract sync, security boundaries, unit/worker tests, Playwright E2E and GitHub CI. Use before merging/pushing fixes, releases, or reporting a feature as done.
---

# Interview change verification and release boundary

Read `AGENTS.md`, `README.md`, `projectstate.md` and `docs/release-checklist.md` first; consult `production-readiness.md` for any interview/AI/scoring/security/privacy release. Match validation scope to the changed code.

## Environment invariants

- Development baseline: Node `25.9.0` (supported `>=25.9.0 <26`), npm `11.6.2` (supported `>=11.6.2 <12`), npm workspaces + Turborepo and the committed `package-lock.json`. Never introduce pnpm/yarn as a hidden prerequisite.
- Follow the repo's **current** `.npmrc` and `AGENTS.md` for the Dotin Nexus development registry. CI can have an intentionally different checkout environment; do not silently change registries to mask a dependency problem.
- Local PostgreSQL baseline is `17.11`; CI's PostgreSQL service version is defined separately in `.github/workflows/quality-gate.yml`. Do not treat the two environments as identical.
- Never log/commit tokens, registry credentials, candidate PII, raw interview audio or connection secrets. Preserve tenant scoping, RBAC, audit and consent.

## Change verification sequence

1. Inspect `git status`, diff and intended branch/HEAD; do not overwrite unrelated work. Name impacted workspaces, API boundaries and migrations. Re-read source of truth before changes.
2. On a fresh workstation or after dependency metadata changes run `node -v`, `npm -v`, `npm run registry:check`, `npm run workspace:check`. Use `npm run install:clean` only for verified stale local lock/module graph, not as a generic workaround.
3. On schema changes run `npm run db:validate`, `npm run db:check`, `npm run db:migrate`, and `npm run db:performance` with a configured database. Migrations must be additive/append-only with compatibility and safe rollback/restore plan as needed.
4. On API changes regenerate and inspect `npm run api:sync`; commit both `openapi/openapi.json` and `packages/api-client/src/generated/schema.ts` if changed. Run `npm run web:contracts` to reject ad-hoc typed-contract bypass.
5. Start with affected targeted tests, then the repository gates below where the environment is available. Browser E2E requires the actual app/test fixture environment; a passing build is not a passing browser test.
6. After push, verify `.github/workflows/quality-gate.yml` status for the **exact commit SHA**. No CI check returned/CI still queued is `PENDING`, never `PASS`. Do not report GitHub issue/PR search emptiness as test success.
7. Separate `CODE_IMPLEMENTED`, `STATIC_TESTED`, `CI_VALIDATED`, `REAL_RUNTIME_VALIDATED` and `PRODUCTION_APPROVED` outcomes. The last two need representative external hardware/provider and release evidence.

## Main project commands

```bash
npm run workspace:check
npm run db:validate
npm run web:contracts
npm run lint
npm run typecheck
npm run e2e:typecheck
npm run test
npm run build
npm run e2e
```

For media/AI changes also select appropriate contract checks, e.g. `npm run candidate-interview-ui:contract:check`, `npm run livekit:config:check`, `npm run whisper:contract:check`, `npm run llm-interviewer:contract:check`, `npm run ai-worker:test`. `npm run check` covers broad static/test/build checks but does not replace real deployment tests.

## Required report

For each change: paths/behavior modified; precise executed commands with pass/fail/skipped; migrations and generated contracts status; security/tenant regression checks; exact commit and CI URL/status if pushed; real-browser/hardware/provider evidence; known failures and next actions. Never invent a green check, a runtime observation or production approval.
