# Shadow Testing Hardening v2 — Validation Note

**Date:** 2026-09-04  
**Pull request:** #8  
**Scope:** code-level Shadow Testing integrity hardening only

This note records the validation target for the Shadow Testing v2 hardening change before it is merged to `main`.

The change is expected to enforce these invariants:

- one immutable Shadow sample per interview session;
- prospective-only sampling after Shadow-program activation;
- AI output remains sealed until an independent human outcome exists;
- manual human outcomes explicitly confirm blind review;
- the human reviewer is independent from the AI-run recorder;
- human outcomes cover the complete rubric and reference only evidence from the same interview;
- evaluator failures are persisted and remain in readiness denominators;
- evaluator latency/retry telemetry and immutable input/outcome/comparison fingerprints are persisted;
- aggregate failure-rate and evidence-agreement gates are included in Shadow readiness summaries;
- Shadow execution does not create consequential scorecards or AI candidate-criterion evaluations and does not mutate application status or pipeline stage.

Required merge evidence is the repository `quality-gate` succeeding on the final PR head, including migration-contract validation, PostgreSQL migrations through `0042`, operational-index verification, generated OpenAPI/client drift checks, lint, typecheck, tests, build, deterministic browser fixtures, and critical browser E2E flows.

This change does **not** claim real LLM, Whisper, LiveKit, or FFmpeg availability; it does not claim representative real-candidate Shadow evidence, supervised-pilot evidence, or production approval. Those remain governed by `production-readiness.md`.
