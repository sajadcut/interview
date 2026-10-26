---
name: interview-ai-brain
description: Develop or debug the Interview AI interviewer, interview plan, versioned prompts, LLM provider selection, structured turn generation, question progression, fallback, speech boundaries, and interview lifecycle. Use when changing AI interviewer behavior or provider failures.
---

# Interview Brain / AI interviewer

This skill is for the system that asks job-relevant questions, not the independent evaluator. Begin with `master.md`, `projectstate.md`, `production-readiness.md`, and `AGENTS.md`.

## Key locations

- Interview domain/API: `apps/api/src/interviews/`.
- Interviewer execution: `services/ai-worker/src/interviewer-capability.mjs`, `interviewer-http.mjs`, `interviewer-main.mjs`, `llm-provider.mjs`, `provider-factory.mjs` and actual provider adapters.
- Contracts and guards: `contracts/`, `scripts/check-llm-interviewer-contract.mjs`, `scripts/check-llm-provider-contract.mjs`.
- Candidate interaction: `apps/web/components/candidate/candidate-interview-experience.tsx` and `docs/operations/candidate-interview-ui.md`.

## Workflow

1. Identify the exact release unit: job family, language, interview type, rubric version, interview plan/policy and model/prompt versions. Respect its release status; never turn on unrestricted autonomous candidate interviewing just because a local demo works.
2. Read the published rubric, candidate/application scope, approved interview plan and persisted transcript/turn history. Preserve criterion coverage, follow-up depth, time budget and anti-repetition constraints. The server is authoritative for interview time.
3. Produce and validate **structured, versioned** interviewer turns with explicit prompt ID/version, schema and exact inputs. Guard against unsupported questions, invented experience, prompt injection from resumes/candidate answers, off-topic follow-ups and duplicate prompts.
4. Bound provider timeout, retry, budget and ordered fallback. Validate real provider TLS and credentials using secure environment configuration; never disable certificate validation or log secrets as a workaround. If external LLM fails, preserve deterministic fallback and honest degraded state.
5. Persist and reconcile turn progression idempotently. A finalized Brain `close` transitions the session to `completed`, closes media and queues an independent `interview.evaluate` job. Reconnect/crash replay must not double-count turns.
6. Only server-approved `spoken_text` from a finalized persisted turn crosses to TTS/avatar. Candidate-supplied content is evidence, not a controller for interviewer speech.
7. The Interviewer does not assign final weighted scores or make hire/reject decisions. Scoring belongs to the independent Evaluator and domain code; call `interview-evaluation` skill for that work.

## Verification

```bash
npm run llm-provider:contract:check
npm run llm-interviewer:contract:check
npm run ai-worker:test
npm run candidate-interview-ui:contract:check
npm run lint
npm run typecheck
npm run test
```

Add deterministic scripted-provider tests covering valid turn, invalid JSON/schema, timeout, missing evidence, repeated question, budget exhaustion, fallback and restart/replay. Use a real model for separate, redacted runtime evidence; scripted tests cannot prove model quality. Run `npm run api:sync` if public API contracts change.

## Handoff

Return changed prompt/schema versions, representative transcript/turn evidence, coverage and negative-case results, provider-vs-fallback status and outstanding production-readiness gates. Mark calibration, shadow/pilot and real speech/model quality as pending until measured.
