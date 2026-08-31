# AI Recruiter Platform — PROJECT STATE

> **Status:** M0 foundation implementation started  
> **Version:** 0.4.0  
> **Date:** 2026-08-31  
> **Purpose:** Current execution state, locked decisions, milestones, risks, open decisions, and next engineering tickets.

---

# 1. Current state

```text
Product architecture              ✅ Defined
Core technical architecture       ✅ Defined
Interview architecture            ✅ Defined
Self-hosted media constraint       ✅ Locked
Production-readiness gates         ✅ Defined
Local-native dev baseline          ✅ Locked
Repository                         ✅ Created
T001 repository bootstrap          🟡 In review / validation pending
Implementation                     🟡 Started
Calibration                        ⬜ Not started
Shadow evaluation                  ⬜ Not started
Pilot                              ⬜ Not started
Production approval                ⬜ Not approved
```

Repository:

```text
https://github.com/sajadcut/interview
```

Active implementation branch:

```text
chore/t001-repository-bootstrap
```

---

# 2. Source-of-truth documents

```text
master.md
→ stable product + architecture contract

projectstate.md
→ this file; current implementation state

production-readiness.md
→ release gates for safe real-candidate autonomous interviewing
```

If implementation conflicts with `master.md`, stop and record an architecture decision before changing the foundation.

---

# 3. Locked architecture decisions

## A01 — Modular monolith first

NestJS modular monolith for core business domains; specialized AI/media workers separate.

## A02 — PostgreSQL is primary system of record

Use PostgreSQL + explicit relational modeling. MongoDB is not the primary domain store.

## A03 — Candidate is organization-global

Candidate is not duplicated per Job. Candidate ↔ Job lifecycle is represented by `Application`.

## A04 — Evidence is first-class

Important score/recommendation output must trace back to evidence.

## A05 — Final scoring is deterministic

LLM may generate criterion evaluation; domain code calculates final weighted score from a versioned rubric.

## A06 — Human review remains available

Final hiring decisions remain human-controlled. Generative score alone does not silently make final rejection/hire decisions.

## A07 — AI provenance is mandatory

Track provider/model/prompt version/input refs/output/review state for consequential AI actions.

## A08 — Provider abstraction

Business modules do not directly depend on a single LLM/STT/TTS/avatar/storage vendor.

## A09 — pgvector before external vector DB

Use PostgreSQL FTS + pgvector until measured scale proves a dedicated vector store is necessary.

## A10 — Drizzle ORM

Use Drizzle + explicit migrations/index control.

## A11 — REST + OpenAPI first

Use generated typed clients between web/API.

## A12 — Temporal when long-running workflow complexity appears

Use Temporal for waits/retries/human signals over days/weeks. Do not require it during initial foundation work.

## A13 — No unsupported face/body psychological inference

Do not score honesty, personality, confidence, emotion, or suitability from face/gaze/body movement/accent.

## A14 — Sourcing uses approved adapters

No hidden/unapproved scraping dependency in core product architecture.

## A15 — Audit from foundation

Consequential business/AI actions are auditable from the beginning.

## A16 — Design System is product-aware

Use reusable primitives plus recruitment-specific components such as `EvidenceBlock`, `MatchScore`, `AIRecommendation`, `Scorecard`, `InterviewMoment`.

## A17 — Dashboard is a Command Center

Home surfaces attention, AI activity, pending review, risks, and recommended actions—not merely KPI cards.

## A18 — Candidate Profile is an Intelligence Workspace

Candidate page unifies experience, skills, match, interview, evidence, assessment, communications, and activity.

## A19 — Interview is a subsystem

Candidate/internal interview UX, dialogue engine, realtime media, transcript, evidence, evaluation, and review are separate concerns.

## A20 — Interview Brain is controlled

Questions are not a static questionnaire and not unconstrained LLM chat. Use plan + state machine + structured turn outputs.

## A21 — Interviewer and Evaluator are separate logical roles

Conversation quality and scoring/evaluation use separate prompts/traces.

## A22 — Avatar is presentation, not intelligence

Avatar renders approved speech; it does not decide interview questions or scoring.

## A23 — Realtime interview must degrade safely

Avatar/media failures must not destroy interview state. Voice-only/reconnect/resume paths are required.

## A24 — No mandatory per-minute media SaaS

Production architecture must have a self-hosted path for RTC/TURN/VAD/STT/TTS/avatar/recording. Only the LLM API is expected to be a usage-based external vendor initially.

## A25 — LiveKit OSS + coturn baseline for realtime production path

Use self-hosted LiveKit OSS and coturn when realtime interview work requires them. Do not require LiveKit Cloud.

## A26 — Local VAD

Use Silero VAD baseline unless benchmarks produce a better commercially usable local option.

## A27 — Local STT

Use `whisper.cpp` as the baseline to benchmark Persian/English and mixed Persian-English technical speech.

## A28 — Local TTS

TTS sits behind `TTSProvider`. Benchmark commercially usable self-hosted Persian TTS; VITS-family is the baseline research path.

## A29 — Local Avatar

Avatar sits behind `AvatarProvider`. Benchmark MuseTalk realtime first; exact model/weights remain open until performance and license review.

## A30 — Actor assets are owned/licensed by us

Professional actor likeness/voice assets require explicit commercial consent and rights.

## A31 — Production interview autonomy is gated

An interview mode cannot be enabled for unsupervised real candidates until it passes `production-readiness.md`.

## A32 — Laptop-first local-native development

Current development is performed directly on a laptop, preferably in VS Code. Docker Desktop, Docker Compose, Kubernetes, and containerized local infrastructure are not required for day-to-day implementation.

Tools are installed locally when the relevant milestone needs them.

## A33 — Local PostgreSQL development baseline

Install and run PostgreSQL directly on the development laptop. Add pgvector locally only when semantic matching work begins.

## A34 — Local filesystem storage during development

Do not require MinIO for M0/M1. Use a `StorageProvider` abstraction with a `LocalFilesystemStorageAdapter` during laptop development.

Production/self-hosted deployment may later use S3, an S3-compatible service, or MinIO without changing domain code.

## A35 — Deferred infrastructure tooling

`infra/` remains a reserved boundary for future Docker/deployment assets. Empty infra folders do not imply Docker is part of the current critical path.

---

# 4. Target repository structure

```text
interview/
├─ apps/
│  ├─ web/
│  └─ api/
├─ services/
│  ├─ ai-worker/
│  └─ media-worker/
├─ packages/
│  ├─ ui/
│  ├─ db/
│  ├─ types/
│  ├─ validation/
│  ├─ config/
│  └─ api-client/
├─ infra/                  # reserved for future deployment assets
├─ master.md
├─ projectstate.md
├─ production-readiness.md
├─ AGENTS.md
├─ package.json
├─ pnpm-workspace.yaml
└─ turbo.json
```

---

# 5. Implementation milestones

## M0 — Foundation

Status: `IN PROGRESS`

Deliverables:

```text
monorepo
Node/pnpm/Turborepo baseline
Next.js web shell
NestJS API shell
local PostgreSQL
Drizzle
organization/user/membership model
tenant context
RBAC
AuditEvent baseline
local filesystem StorageProvider
AI/provider interfaces
shared validation/types
Design System foundation
OpenAPI typed client pipeline
GitHub Actions CI
observability baseline
```

Explicitly **not required merely to finish early M0**:

```text
Docker
Docker Compose
MinIO
Kubernetes
Temporal
LiveKit
coturn
GPU/avatar runtime
```

Exit condition: create an organization/user, call an authenticated/authorized API, persist tenant-safe data in local PostgreSQL, store a development file through `StorageProvider`, produce an audit event, and run CI.

## M1 — Job → Candidate → Evidence vertical slice

Status: `NOT STARTED`

Deliverables:

```text
Job CRUD/workspace
AI Job Builder structured output
Job requirements
Must-have / nice-to-have skills
Seniority/experience
Rubric + versioning
Candidate
Resume upload through StorageProvider
Resume parsing
Application
Candidate/job matching
Evidence records
Pipeline stages/transitions
Criterion evaluations
Deterministic final score
Human review/override
Candidate compare
Shortlist
```

This is the first real product slice and remains prioritized before production video interview work.

## M2 — Sourcing + Talent

Status: `NOT STARTED`

Deliverables:

```text
CandidateSourceAdapter
SourcingRun
Search strategy
Source normalization
Candidate identity resolution/deduplication
Ranked discovered candidates
Internal talent rediscovery
Talent pools
```

## M3 — Outreach + Screening + Scheduling

Status: `NOT STARTED`

Deliverables:

```text
Conversation/Message
Inbox split-view
Outreach templates/sequences
Approved company/job knowledge retrieval
Candidate intent detection
Structured screening
Eligibility rules
Calendar integration
Interview scheduling
Reminders
Temporal workflows when justified
```

## M4 — AI Interview

Status: `NOT STARTED`

### M4.0 Realtime infrastructure

```text
LiveKit OSS self-hosted
coturn
room/token service
candidate/internal room topology
recording strategy
reconnect/resume behavior
```

These may be installed directly on suitable development hardware or moved to another machine later; containers are not required by architecture.

### M4.1 Local speech

```text
Silero VAD
whisper.cpp benchmark
Persian STT benchmark
Persian + English technical code-switch benchmark
TTSProvider
local Persian TTS benchmark
latency/quality measurements
```

### M4.2 Digital Human

```text
AvatarProvider
MuseTalk benchmark
actor recording specification
idle/listening avatar asset pipeline
voice/likeness rights checklist
GPU throughput benchmark
voice-only fallback
```

### M4.3 Interview Brain

```text
InterviewPlan
Rubric evidence objectives
Dialogue state machine
Structured Turn Contract
follow-up strategy
clarification handling
candidate skip handling
time budget
resume claim validation
contradiction signals
LLMProvider call
```

### M4.4 Evaluation

```text
transcript segments
question/answer mapping
evidence extraction
independent Evaluator
criterion scores
ScoreEngine
key moments/timestamps
internal review
human override
```

M4 definition of done includes:

```text
Candidate speaks
→ local VAD
→ local STT
→ Interview Brain + paid LLM
→ local TTS
→ local Avatar
→ self-hosted realtime media
→ Candidate sees/hears interviewer
→ transcript/evidence stored
```

It must run without mandatory hosted STT, hosted TTS, hosted avatar, or hosted RTC credentials.

## M5 — Assessments

Status: `NOT STARTED`

## M6 — Analytics + Enterprise hardening

Status: `NOT STARTED`

---

# 6. M0 engineering tickets

## T001 — Repository bootstrap

Status: `IN REVIEW`

Acceptance:

- pnpm workspace;
- Turborepo;
- `apps/web`;
- `apps/api`;
- `services/ai-worker` placeholder;
- `services/media-worker` placeholder;
- shared package skeletons;
- root formatting/lint/typecheck scripts;
- `.editorconfig`, `.gitignore`, `.env.example`;
- `AGENTS.md`.

Current PR:

```text
PR #1 — T001: bootstrap repository monorepo
```

Pending before DONE:

```text
pnpm install
lint
typecheck
build
```

## T002 — Local developer prerequisites

Status: `BLOCKED BY T001`

Replaces the previous Docker Compose infrastructure ticket.

Install/configure only what is required for the next slice:

```text
PostgreSQL local service
local development database/user
connection environment variables
health/connectivity verification
.local-data/storage directory convention
```

Redis is deferred until a real feature requires it. MinIO is not part of T002.

## T003 — API baseline

Status: `BLOCKED BY T001`

NestJS app with health endpoint, structured config, validation, logging, correlation ID, error conventions, and OpenAPI.

## T004 — Database baseline

Status: `BLOCKED BY T002/T003`

Drizzle setup, migrations, timestamp/id conventions, organization/user/membership first tables.

pgvector extension may be deferred until matching/vector work starts.

## T005 — Tenant Context

Status: `BLOCKED BY T004`

Resolve organization context on each authenticated business request and enforce tenant-safe repository/service queries.

## T006 — Authorization

Status: `BLOCKED BY T005`

Role/permission model + policy guard utilities + authorization tests.

## T007 — Audit foundation

Status: `BLOCKED BY T004/T006`

`AuditEvent` model/service and hooks for consequential mutations.

## T008 — StorageProvider baseline

Status: `BLOCKED BY T001/T003`

Define `StorageProvider` and implement `LocalFilesystemStorageAdapter` for laptop development. Do not require MinIO.

## T009 — AI Gateway interfaces

Status: `BLOCKED BY T001/T003`

Define provider-neutral interfaces and `AIExecution` provenance record.

## T010 — Web/App shell + Design System

Status: `BLOCKED BY T001`

Next.js shell, routing conventions, typography/spacing/tokens, navigation primitives, reusable product-aware UI foundation.

## T011 — Typed API client

Status: `BLOCKED BY T003/T010`

Generate typed client from OpenAPI and integrate with TanStack Query.

## T012 — CI

Status: `BLOCKED BY T001`

GitHub Actions for install, lint, typecheck, unit tests, build, and migration validation.

---

# 7. Initial database migration order

```text
001 base conventions
002 users + organizations + memberships
003 roles + permissions
004 audit_events
005 files/storage metadata
006 jobs
007 job requirements + skills
008 rubrics + rubric versions + criteria
009 candidates + identities
010 candidate experiences/education/skills
011 resumes
012 applications
013 pipelines + stages + transitions
014 evidence
015 AI executions
016 criterion evaluations + scorecards + overrides
```

Do not create interview tables before the core candidate/application/evidence model is stable unless a spike specifically requires them.

---

# 8. Frontend build order

```text
Design tokens / App shell
→ Job list
→ Job creation / AI Job Builder
→ Job Workspace
→ Candidate table
→ Candidate Intelligence Workspace
→ Pipeline
→ Evidence/Scorecard
→ Candidate Compare/Shortlist
→ Sourcing
→ Inbox/Outreach
→ Screening
→ Scheduling
→ Interview candidate experience
→ Interview review
→ Analytics
```

This intentionally avoids building a dashboard full of fake KPI cards before real domain data exists.

---

# 9. Local workstation baseline

Preferred current setup:

```text
Laptop
VS Code
Git
Node.js 24 LTS
pnpm 11
PostgreSQL installed locally
```

Install later when required:

```text
Python
Redis
pgvector
FFmpeg
whisper.cpp
LiveKit OSS
coturn
local TTS runtime
avatar/GPU dependencies
Temporal
```

Not required for current development:

```text
Docker Desktop
Docker Compose
MinIO
Kubernetes
```

---

# 10. Open decisions

## O01 — Initial target market / jurisdiction

Impacts compliance, candidate notice, recording, retention, and employment-AI controls.

## O02 — Production cloud/hosting and region

Deferred. Current development is local-native.

## O03 — First customer authentication model

Password/magic link vs enterprise SSO timing.

## O04 — First approved sourcing integrations

Do not infer LinkedIn/job-board access without contract/API confirmation.

## O05 — First outbound communication channels

Email is likely baseline; other channels need integration/policy decisions.

## O06 — Default retention period

Needs product/legal decision.

## O07 — Recording policy

Mandatory vs optional vs organization-configurable.

## O08 — First launch job families

Recommended: begin with a small number of well-defined job families for calibration.

## O09 — Persian/English UX default

Need explicit RTL/LTR strategy.

## O10 — Compensation knowledge policy

Decide what candidate-facing AI may disclose per job/org.

## O11 — Target GPU + concurrency

Need benchmark before capacity planning.

## O12 — Final Persian TTS

Benchmark latency, naturalness, pronunciation, licensing, CPU/GPU requirements.

## O13 — Actor voice/likeness contract

Must explicitly permit commercial digital-avatar and synthetic-voice use.

## O14 — Final Avatar model/version

MuseTalk is benchmark baseline, not production lock.

## O15 — Whisper model/quantization

Benchmark WER/latency on Persian, Persian-English technical code-switching, and noisy consumer microphones.

---

# 11. Risk register

## R01 — Persian speech quality

STT/TTS may be noticeably worse for mixed Persian-English technical interviews. Build an evaluation dataset early.

## R02 — Realtime latency

STT + LLM + TTS + avatar may create unnatural pauses. Measure stages separately and degrade avatar before conversation quality.

## R03 — Laptop resource limits

Local development hardware may not comfortably run database, STT, TTS, avatar, and realtime services concurrently.

Mitigation:

```text
install services only when needed
run one heavy worker at a time during early development
allow future worker placement on another machine
preserve network/provider interfaces
```

## R04 — AI evaluation trust

Use evidence-first design, independent evaluator, deterministic scoring, shadow mode, and human calibration.

## R05 — Candidate false rejection

Use production gates, low-confidence routing, false-rejection measurement, and human review.

## R06 — Licensing

OSS code license does not guarantee every model weight/dataset is commercially suitable. Freeze licenses before production.

## R07 — Sourcing platform restrictions

Use approved adapters; internal talent pool remains first-class.

## R08 — Privacy / candidate recordings

Use consent, secure access, retention/deletion, tenant isolation, and audit.

## R09 — Overbuilding early

Do not build full interview/avatar before candidate/evidence/scoring foundation. Spikes are allowed only when isolated.

## R10 — Local/production environment drift

Laptop-native development may differ from final production infrastructure.

Mitigation: keep configuration externalized, capability interfaces explicit, filesystem/storage replaceable, database migrations reproducible, and containerization as a later deployment concern.

---

# 12. Production status semantics

```text
DEV_ONLY
INTERNAL_TEST
SHADOW
SUPERVISED_PILOT
CONTROLLED_PRODUCTION
SCALED_PRODUCTION
SUSPENDED
```

No feature can claim `CONTROLLED_PRODUCTION` or higher unless the relevant approval exists in `production-readiness.md`.

---

# 13. Immediate next action

Finish validation of `T001 — Repository bootstrap`.

Then proceed to the revised local-native critical path:

```text
T001 Repository Bootstrap
→ T002 Local PostgreSQL + workstation prerequisites
→ T003 API Baseline
→ T004 Database Baseline
→ T005 Tenant Context
→ T006 Authorization
→ T007 Audit
→ T008 Local StorageProvider
→ T009 AI Gateway
→ T010 Web + Design System
→ T011 Typed API Client
→ T012 CI
→ M1 vertical slice
```

Docker, MinIO, and production deployment work are intentionally outside the current critical path.
