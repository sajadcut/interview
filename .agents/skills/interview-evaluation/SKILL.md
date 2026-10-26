---
name: interview-evaluation
description: Design, debug, or verify Interview evidence-backed technical/observable soft-skill evaluation, rubric scorecards, evaluator jobs, human review, calibration, integrity signals, and audit-safe recommendations. Use for scoring, evaluation reports or cheating-signal reviews.
---

# Evidence-based interview evaluation

Read `master.md`, `projectstate.md`, `production-readiness.md` and `AGENTS.md`. Use this skill for the independent Evaluator, not for generating interviewer questions.

## Source files

- Evaluation contracts/services: `apps/api/src/interviews/interview-evaluator.ts`, `interview-evaluator.service.ts`, `interview-review.service.ts` and their `*.spec.ts` tests.
- Presentation: `apps/web/components/interviews/interview-review.tsx`.
- Worker boundary: `services/ai-worker/src/` (inspect actual `interview.evaluate` capability/handler before edits).
- Data/versioning: `packages/db/migrations/`, `openapi/openapi.json`, `packages/api-client/src/generated/schema.ts`.
- Release evidence: `production-readiness.md`, especially evidence, calibration, false rejection/promotion and fairness gates.

## Evaluation protocol

1. Resolve the **persisted** candidate/application/session and pinned published rubric version. The evaluator only reads finalized candidate answers, timestamps, transcript/evidence links, assessment results if in scope, and rubric criteria; never invent unsupported evidence.
2. Extract criterion-level, attributable evidence (turn ID/transcript span/source). Distinguish observed behavior from speculation; missing or contradictory evidence must become `insufficient_evidence` or an explicit uncertainty, not a made-up low/high score.
3. Separate measurable technical competencies and observable communication/collaboration/problem-solving from integrity metadata. Never infer honesty, personality, emotion, mental state, or job suitability from face/gaze/body/accent. Focus/visibility/paste/reconnect signals are review aids, **not proof of cheating**, automatic score penalties, or rejection triggers.
4. Validate evaluator structured output and idempotently persist provenance: model/provider, prompt/schema version, rubric/input fingerprint, criterion evidence, confidence where warranted, and review state. Final weighted score is calculated deterministically by domain code, not returned as LLM authority.
5. Keep AI recommendations independent of human decisions. Human override requires actor, old/new value, explicit reason and timestamp. Technical approval and hiring decisions remain human-owned, with tenant permission checks.
6. Compare evaluator output with adjudicated human examples; measure disagreements, false rejection/promotion, missing-evidence frequency, language/group fairness, calibration and replay across model/prompt changes. Do not call test fixtures a real calibration study.
7. When changing scoring semantics, add negative tests for missing evidence, conflicting observations, duplicate evaluation jobs, replay stability, cross-tenant leakage, rubric version drift, unsupported high scores and suspicious-but-non-decisive integrity events.

## Verification

```bash
npm run llm-provider:contract:check
npm run ai-worker:test
npm run db:validate
npm run lint
npm run typecheck
npm run test
npm run build
```

Run relevant evaluator/review unit and PostgreSQL integration tests, regenerate APIs with `npm run api:sync` when contracts change, and exercise the real review UI using `npm run e2e` when its environment is ready.

## Required outcome

Deliver a criterion-by-criterion evidence trail, version/policy provenance, deterministic replay evidence, human review controls and a list of calibration/shadow/pilot gaps. An integrity event alone must never be reported as a confirmed fraud finding.
