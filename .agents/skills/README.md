# Interview repository Agent Skills

These are **development-agent** workflows for Codex and other compatible Agent Skills readers. They are instructions for contributors working on this repository; they **do not** automatically install capabilities, tools, or integrations into the Interview product's runtime AI agents.

Each skill is independently discoverable through YAML `name` and `description` in its own `SKILL.md`. Read `AGENTS.md` first, then open **only the relevant** skill(s) for the task.

| Skill | Choose for |
| --- | --- |
| [interview-recruitment-workflow](interview-recruitment-workflow/SKILL.md) | Requisition -> HR approval -> job publication -> resume matching -> candidate/application -> interview |
| [interview-realtime-media](interview-realtime-media/SKILL.md) | Camera/mic, permission/track lifecycle, LiveKit, VAD, STT, TTS and reconnection |
| [interview-ai-brain](interview-ai-brain/SKILL.md) | Interview prompts, LLM provider, structured turns, state and speech boundary |
| [interview-evaluation](interview-evaluation/SKILL.md) | Evidence, criterion scorecards, integrity review, calibration, human oversight |
| [interview-persian-ux](interview-persian-ux/SKILL.md) | Persian RTL UI, responsive tables/forms, numeric formatting, visual E2E |
| [interview-quality-gate](interview-quality-gate/SKILL.md) | Before push/release, contract sync, CI, tests, production evidence gates |

## Typical combinations

- `Fix setup webcam turning off before the room starts` -> `interview-realtime-media` + `interview-quality-gate`.
- `Add bulk edit/delete to a Persian jobs table` -> `interview-recruitment-workflow` + `interview-persian-ux` + `interview-quality-gate`.
- `Fix AI interviewer questions and scoring reports` -> `interview-ai-brain` + `interview-evaluation` + `interview-quality-gate`.
- `Test a .NET hiring request from team submission through a finished technical interview` -> `interview-recruitment-workflow` + `interview-realtime-media` + `interview-evaluation` + `interview-quality-gate`.

## Guardrails

- Reuse `master.md`, `projectstate.md`, `production-readiness.md` and the existing application code as the source of truth; do not replace their policies with a skill.
- No skill may bypass tenant/permission, consent, audit, evidence-based evaluation or human hiring-decision boundaries.
- Report which commands ran and what remains `VALIDATION_PENDING`; source edits/CI contracts are not real device/provider or production approval evidence.
- Keep skills concise; when a workflow changes, update its `SKILL.md` alongside the implementing code and tests.
