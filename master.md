# AI Recruiter Platform — MASTER

> **Status:** Architecture baseline approved for implementation  
> **Version:** 0.5.0  
> **Date:** 2026-08-31  
> **Purpose:** Single source of truth for product boundaries, engineering architecture, UX principles, AI behavior, security, data model, interview architecture, development environment, and delivery order.

---

# 0. How to use this document

- `master.md` defines stable product and technical architecture.
- `projectstate.md` defines actual implementation status, tickets, risks, and pending validation.
- `production-readiness.md` defines gates for safe real-candidate autonomous interviewing.
- `docs/visual-product-target.md` defines the approved internal-product visual acceptance target.
- `docs/architecture-decisions/*` records architecture changes and history.
- `AGENTS.md` defines implementation constraints for humans and coding agents.

Major architecture changes must be reflected here and in `projectstate.md`.

---

# 1. Product definition

## 1.1 North star

Build an AI Recruiter that can execute a large part of the recruiting lifecycle:

```text
Job definition
→ Candidate discovery
→ Candidate ranking
→ Outreach
→ Screening
→ Scheduling
→ AI interview
→ Technical / role assessment
→ Evidence-backed scoring
→ Candidate comparison
→ Shortlist
→ Human decision
→ Talent pool
```

The product is not only an ATS and not only a video-interview tool. The differentiator is an AI recruiting agent that can execute the workflow up to a defensible shortlist while preserving human review for consequential employment decisions.

## 1.2 Primary outcomes

1. Reduce recruiter manual work.
2. Find relevant candidates faster.
3. Reuse internal and previous candidates.
4. Make screening and interviews consistent and job-specific.
5. Validate claimed skills using resume, interview, and assessment evidence.
6. Produce traceable candidate evaluations.
7. Reduce time-to-hire.
8. Keep consequential employment decisions human-reviewable.
9. Support Persian and English.
10. Support enterprise permissions, audit, privacy, retention, and integrations.

---

# 2. Non-negotiable product principles

## 2.1 Job-centric, candidate-global

A `Job` defines requirements, rubric, pipeline, sourcing strategy, screening rules, and interview plan.

A `Candidate` is organization-level and can participate in many jobs through `Application`.

```text
Organization
 ├─ Jobs
 │   └─ Applications ── Candidate
 └─ Talent Pool ─────── Candidate
```

Do not duplicate a candidate because they are considered for another job.

## 2.2 AI is not the source of truth

AI may extract, suggest, rank, draft, summarize, score criteria, recommend next actions, generate follow-up questions, and retrieve evidence.

High-impact AI output must store provenance:

```text
provider/model
prompt/version
input references
structured output
confidence when meaningful
evidence references
created_at
review state
override/reviewer when applicable
```

## 2.3 Evidence before score

```text
Observation / answer / resume claim / assessment result
→ Evidence
→ Criterion evaluation
→ Weighted score
→ Recommendation
```

A consequential score without evidence is incomplete.

## 2.4 Deterministic final scoring

LLMs may propose criterion-level evaluations. Final weighted scores are calculated by domain code from a versioned rubric. The LLM does not invent the final fit percentage.

## 2.5 Human-in-the-loop by default

- AI may suggest rejection, but generative judgment alone cannot silently reject a candidate.
- Hard eligibility filters may be automated only when explicitly configured and auditable.
- AI recommendations must be reviewable and overridable.
- Score overrides require actor, reason, previous value, new value, and timestamp.
- Final hiring decisions remain human-controlled.

## 2.6 No unsupported psychological or biometric inference

Do not infer personality, honesty, emotional state, mental traits, confidence, or job suitability from facial appearance, gaze, body movement, accent, or other weak/non-defensible biometric signals.

Video is used for interview experience, recording/replay, timestamped evidence, and session integrity where lawful—not pseudoscientific personality scoring.

## 2.7 Candidate experience is first-class

Candidate-facing flows require clear consent, recording disclosure, device checks, accessibility, understandable next steps, multilingual support, error recovery, and privacy information.

## 2.8 Interview automation has a release boundary

No interview mode is production-safe merely because a realtime demo works.

Autonomous interviewing is enabled only after the relevant combination of job family, language, rubric, interview type, interviewer policy, evaluator version, and speech/avatar stack passes `production-readiness.md`.

Every autonomous interview mode requires:

- versioned interview plan and rubric;
- explicit allowed and forbidden behaviors;
- structured turn outputs;
- independent evaluator;
- evidence-linked criterion scoring;
- recoverable checkpoints;
- low-confidence escalation;
- replay/review;
- calibration against qualified human evaluators;
- measurable SLOs.

## 2.9 No mandatory per-interview media SaaS dependency

The core interview path must retain a commercially usable self-hosted implementation for:

- WebRTC/media transport;
- TURN/STUN;
- VAD;
- STT;
- TTS;
- realtime digital-human/avatar rendering;
- recording/storage.

Target variable vendor cost:

```text
LLM API            allowed / expected initially
STT API            not required
TTS API            not required
Avatar API         not required
RTC/media SaaS     not required
```

Self-hosted media still has CPU/GPU, bandwidth, storage, hosting, electricity, TURN, and operations cost.

## 2.10 Interview Brain and Digital Human are separate

```text
Job + Resume + Rubric
        ↓
Interview Planner
        ↓
Dialogue Engine / Interview Brain
        ↓
spoken_text
        ↓
TTSProvider
        ↓
AvatarProvider
        ↓
Candidate
```

The Interview Brain owns state, question strategy, follow-ups, evidence coverage, timing, and policy. Avatar rendering only presents approved speech.

The AI Interviewer and AI Evaluator are logically separate. The Interviewer optimizes the conversation. The Evaluator scores persisted evidence against the rubric.

---

# 3. Human roles and product surfaces

| Role | Main responsibility |
|---|---|
| Recruiter | Jobs, sourcing, outreach, screening, pipeline, candidate review |
| HR Manager | Policy, approvals, oversight, reporting |
| Hiring Manager | Requirements, shortlist, comparison, final feedback |
| Interviewer | Assigned interviews, scorecards, evidence review |
| Organization Admin | Members, roles, integrations, privacy/settings |
| Candidate | Screening, scheduling, interview, assessment, consent |

AI actions are represented as explicit machine actors in audit logs.

## 3.1 Internal company application

Recruiter, HR Manager, Hiring Manager, Interviewer, and Admin share one internal application. Navigation and available actions depend on role and permission.

```text
Internal App
├─ Home / Command Center
├─ Jobs
├─ Candidates
├─ Talent
├─ Interviews
├─ Inbox / Outreach
├─ Analytics
├─ Automations
├─ Integrations
└─ Settings
```

## 3.2 Candidate experience

Candidate-facing flows are a separate security and UX surface.

```text
Secure invitation / magic link / OTP
→ identity verification when required
→ consent
→ device check
→ screening / interview / assessment
→ completion
```

Candidate users do not enter the internal HR application.

## 3.3 AI Interviewer

The AI Interviewer is a system actor and has no login. It operates through versioned interview policy and provider abstractions.

---

# 4. Product workspaces

## 4.1 Job Workspace

```text
Job
├─ Overview
├─ Candidates
├─ Sourcing
├─ Outreach
├─ Pipeline
├─ Interviews
├─ Scorecards
├─ Analytics
├─ Activity
└─ Settings
```

Sourcing is contextual to a Job rather than a top-level navigation explosion.

## 4.2 Candidate Intelligence Workspace

```text
Candidate
├─ Overview
├─ Experience
├─ Skills
├─ Job Matches
├─ Screening
├─ Interviews
├─ Assessments
├─ Communications
├─ Notes
└─ Activity
```

Candidate profile is an intelligence workspace, not a CV viewer.

## 4.3 Interview subsystem

Candidate side:

```text
Invite
→ Consent
→ Device Check
→ Introduction
→ AI Interview
→ Technical task when applicable
→ Completion
→ Feedback
```

Internal review side:

```text
Interview Plan
Rubric
Question Strategy
Session
Transcript
Evidence
Scorecard
Key Moments
Decision Support
```

---

# 5. Technical architecture

## 5.1 Architecture style

Start as a modular monolith plus specialized workers.

```text
apps/web                Next.js / React / TypeScript
apps/api                NestJS modular monolith
services/ai-worker      AI/evaluation workloads when needed
services/media-worker   realtime speech/avatar/media workloads when needed
packages/*              shared UI/types/validation/config/db/api-client
```

Do not start with microservices.

## 5.2 Development environment — LOCAL NATIVE BASELINE

Current development is laptop-first and local-native. Docker is not required for day-to-day development.

```text
Laptop
└─ VS Code
   ├─ Node.js 25.9.x
   ├─ npm 11.6.x
   ├─ Git
   ├─ PostgreSQL installed locally
   ├─ Python installed locally when AI/media work begins
   ├─ Redis installed locally only when a feature actually requires it
   ├─ pgvector installed when candidate semantic matching begins
   └─ project processes started directly from terminals/tasks
```

Development commands must work without Docker Desktop, Docker Compose, Kubernetes, or MinIO.

### Local development principles

1. Prefer direct installation of required developer tools on the laptop.
2. Do not introduce Docker solely for convenience during the current implementation stage.
3. Add a local service only when the current milestone requires it.
4. Keep service interfaces deployment-independent.
5. Development simplicity must not leak laptop-specific assumptions into domain code.

### Intended local process layout

```text
VS Code
├─ Terminal: npm run dev:web      → Next.js
├─ Terminal: npm run dev:api      → TypeScript watch + Node/Nest runtime
├─ PostgreSQL local service
├─ Redis local service            → only when needed
├─ Python ai-worker               → when needed
└─ Python media-worker            → when interview work begins
```

VS Code is preferred, but the repository must remain terminal-first and must not depend on proprietary editor behavior.

## 5.3 Package manager and monorepo

The active JavaScript monorepo contract is:

```text
Node.js          >=25.9.0 <26
npm              >=11.6.2 <12
npm workspaces   root package.json
Turborepo        task orchestration
package-lock.json canonical lockfile
```

Do not use `workspace:*` dependency protocol with npm 11.6.x. Internal workspaces use standard semver ranges matching the local workspace version.

`pnpm-workspace.yaml` and `pnpm-lock.yaml` are not part of the active architecture.

## 5.4 npm registry and dependency reproducibility

Dependency resolution uses the public npm registry:

```text
https://registry.npmjs.org/
```

The root `.npmrc` enforces HTTPS, strict engine checks and bounded retry/timeouts. `package-lock.json` is the canonical dependency graph and must be committed. CI uses the committed lockfile with `npm ci`; it must not delete or regenerate the lockfile during the quality gate. Dependency changes require an explicit lockfile update followed by the full quality gate.

Installation analytics through Scarf are disabled at the root package level.

## 5.5 NestJS 12 on Node 25

NestJS 12 remains the backend application framework.

The active Node 25 workstation does **not** depend on Nest CLI/schematics because their current Angular-devkit dependency line excludes Node 25. This is a tooling constraint, not a reason to replace NestJS runtime.

```text
TypeScript compiler
→ dist/
→ Node.js 25
→ NestJS application runtime
```

Development watch is implemented without `@nestjs/cli`.

Do not reintroduce `@nestjs/cli` or `@nestjs/schematics` until their Node 25 compatibility is explicitly validated.

## 5.6 Production/deployment portability

Docker/containerization is deferred, not rejected.

Future deployment work may add Dockerfiles, container registry, production process orchestration, GPU worker containers, or cloud deployment definitions. These are not current workstation prerequisites.

## 5.7 Core stack

```text
Runtime              Node.js 25.9.x
Package manager      npm 11.6.x + npm workspaces
Task orchestration   Turborepo
Frontend             Next.js 16.3 line + React 19 + TypeScript
Styling              Tailwind CSS
UI primitives         source-owned shadcn-like internal design system
Server state          TanStack Query
Tables                TanStack Table when domain tables mature
Forms                 React Hook Form + Zod when form slices land
Small client state    Zustand only where justified
Backend               NestJS 12 modular monolith
AI/media workers      Python where advantageous
Database              PostgreSQL 18.x, local during development
ORM                   Drizzle ORM
Vector                pgvector when matching requires it
Cache/ephemeral       Redis only when requirements justify it
Workflow              Temporal when long-running workflows require it
Object storage        StorageProvider; local filesystem in development
Realtime media        LiveKit OSS self-hosted when interview work begins
TURN                   coturn
VAD                    Silero VAD baseline
STT                    whisper.cpp baseline; Persian benchmark required
TTS                    self-hosted provider interface; VITS-family benchmark
Avatar                 self-hosted AvatarProvider; MuseTalk benchmark baseline
Observability          OpenTelemetry + structured logs; Sentry-compatible tracking later
CI/CD                  GitHub Actions
IDE                    VS Code preferred
```

---

# 6. Storage architecture

Business modules must not depend directly on MinIO, AWS S3, or the local filesystem.

```text
StorageProvider
├─ put(file, metadata)
├─ get(key)
├─ delete(key)
├─ exists(key)
└─ createReadReference(key)
```

Current development implementation:

```text
LocalFilesystemStorageAdapter
→ .local-data/storage/
```

Production later uses `S3StorageAdapter` or `S3CompatibleStorageAdapter`. MinIO remains optional future infrastructure, not a development requirement.

---

# 7. Backend bounded modules

Initial NestJS bounded modules include:

```text
auth
organizations
memberships
permissions
jobs
rubrics
candidates
resumes
applications
matching
sourcing
outreach
knowledge-base
screening
scheduling
interviews
assessments
scoring
shortlists
talent-pool
analytics
notifications
integrations
audit
privacy
ai
```

Business modules call capability interfaces. They must not directly lock domain code to an AI, storage, STT, TTS, avatar, media, or infrastructure vendor.

---

# 8. Repository shape

```text
interview/
├─ apps/
│  ├─ web/
│  └─ api/
├─ services/               specialized workers when milestones require them
│  ├─ ai-worker/
│  └─ media-worker/
├─ packages/
│  ├─ ui/
│  ├─ db/
│  ├─ types/
│  ├─ validation/
│  ├─ config/
│  └─ api-client/
├─ infra/                  future deployment assets
├─ docs/
│  ├─ architecture-decisions/
│  └─ visual-product-target.md
├─ master.md
├─ projectstate.md
├─ production-readiness.md
├─ AGENTS.md
├─ package.json
├─ package-lock.json        generated/committed after validated npm install
└─ turbo.json
```

---

# 9. Core data model

Primary entities:

```text
Organization
User
Membership
Role
Permission
Department
Job
JobRequirement
Rubric
RubricCriterion
RubricVersion
Candidate
CandidateIdentity
CandidateExperience
CandidateEducation
CandidateSkill
Resume
ResumeDocument
Application
Pipeline
PipelineStage
PipelineTransition
Evidence
CandidateCriterionEvaluation
Scorecard
ScoreOverride
AIExecution
SourcingRun
DiscoveredCandidate
Conversation
Message
ScreeningSession
InterviewPlan
InterviewSession
InterviewTurn
InterviewQuestion
CandidateAnswer
InterviewTranscriptSegment
InterviewEvidence
InterviewEvaluation
InterviewRecording
Assessment
AssessmentSession
AssessmentResult
Shortlist
TalentPool
Activity
AuditEvent
ConsentRecord
RetentionPolicy
Integration
Notification
RecruitmentEvent
```

`Application` is the Candidate ↔ Job relationship and owns job-specific lifecycle state. Candidate identity remains organization-global.

---

# 10. Resume ingestion and matching

```text
Upload
→ StorageProvider
→ text extraction
→ structured parsing
→ experience/skills extraction
→ chunks
→ embeddings when enabled
→ evidence candidates
→ candidate profile update
```

Candidate matching is not cosine similarity converted into a percentage.

Match scoring combines explicit domain signals such as must-have skills, relevant experience, seniority, context relevance, verified skills, screening, assessment, and interview evidence.

Vector search is a retrieval signal, not the final business score.

---

# 11. Evidence and scoring architecture

Evidence is first-class and should deep-link to source material and timestamps where possible.

```text
Rubric Version
    ↓
Criterion Evaluations + Evidence
    ↓
Deterministic ScoreEngine
    ↓
Overall Score
    ↓
Recommendation
    ↓
Human Review / Override
```

Every override records previous value, new value, actor, reason, and timestamp.

---

# 12. Sourcing architecture

All sourcing is adapter-based:

```text
CandidateSourceAdapter
├─ InternalTalentPoolAdapter
├─ ATSAdapter
├─ ApprovedJobBoardAdapter
└─ ApprovedExternalSourceAdapter
```

Internal talent pool is searched first. Query expansion may include title/skill synonyms. Full-text and semantic retrieval may be combined, but retrieval similarity is not the final candidate score.

Do not make hidden or unapproved platform scraping a core dependency. LinkedIn access, if present, must be lawful/authorized integration—not assumed scraping.

Identity resolution/deduplication uses strong identifiers plus supporting signals; ambiguous merges require human review.

---

# 13. Outreach and candidate conversation

Candidate-facing answers about salary, remote policy, benefits, process, and similar facts must be grounded in approved company/job knowledge.

```text
Candidate question
→ intent
→ approved knowledge retrieval
→ draft response
→ policy validation
→ human approval or configured auto-send
```

---

# 14. Workflow orchestration

Temporal is intended for real long-running workflows involving waits, retries, callbacks, and human signals. It is not required during the early foundation work.

Do not model multi-day recruiting workflows as fragile cron chains and boolean flags.

---

# 15. AI Interview architecture

## 15.1 Core media/dialogue loop

```text
Candidate WebRTC
→ LiveKit OSS
→ Silero VAD
→ local STT
→ transcript
→ Interview Brain
→ LLMProvider
→ structured turn
→ local TTS
→ AvatarProvider
→ LiveKit audio/video
→ Candidate
```

coturn provides TURN/STUN where needed.

## 15.2 Interview plan and state

Plan derives from Job, Rubric, Seniority, Resume/Candidate history, interview template, time budget, and organization policy.

Track at least:

```text
current criterion
asked questions
evidence found/missing
criterion confidence
remaining time
resume claim under validation
contradiction signals
candidate intent
session/reconnect state
```

Supported candidate intents include ANSWER, CLARIFICATION_REQUEST, SKIP_REQUEST, INTERRUPTION, SILENCE/TIMEOUT, RECONNECT, CANDIDATE_QUESTION, and POLICY_REFUSAL.

Questions follow a controlled state graph, not a static list and not unconstrained chat.

## 15.3 Structured turn contract

A turn may resemble:

```json
{
  "action": "probe",
  "criterion": "kubernetes",
  "objective": "production_debugging",
  "spoken_text": "یه نمونه از مشکلی که در production با Kubernetes داشتی برام تعریف می‌کنی؟",
  "expected_evidence": ["logs", "events", "metrics", "root cause"]
}
```

Only approved `spoken_text` reaches TTS/avatar.

## 15.4 Interviewer vs Evaluator

```text
AI Interviewer
→ manages dialogue and evidence collection

AI Evaluator
→ independently evaluates finalized evidence against rubric
```

Separate prompts/traces/roles are mandatory for production evaluation.

## 15.5 Digital human

Avatar is presentation only and never owns interview intelligence.

Professionally recorded actor assets require explicit commercial likeness/voice rights. The target is professional/respectful digital-human interaction, not deceptive indistinguishability from a human.

Candidate video/audio may provide job-relevant timestamped evidence and session-integrity signals where lawful, but must not be used for unsupported emotion/honesty/personality/confidence inference.

---

# 16. Assessments

Coding assessment architecture:

```text
Question
→ Web editor
→ Submission
→ isolated runner
→ tests
→ structured result
→ evidence analysis
→ rubric evaluation
```

Candidate code must never execute directly in the core API process.

---

# 17. Analytics

Initial analytics may use PostgreSQL. Introduce a dedicated analytics store only after measured volume justifies it.

Core metrics include pipeline conversion, stage duration, time-to-hire, source quality, outreach response, interview completion, human/AI calibration, low-confidence rate, and false-rejection analysis.

---

# 18. Security, privacy, and governance

Foundation requirements:

- organization/tenant isolation;
- RBAC and explicit permissions;
- audit log for consequential actions;
- candidate consent records;
- video/audio recording disclosure;
- configurable retention/deletion;
- secure storage access;
- AI execution provenance;
- human override history;
- no unsupported biometric/personality scoring.

Production secret management must not rely on committed `.env` files. Local `.env` files are acceptable for laptop development and must be ignored by Git.

---

# 19. Frontend and Design System principles

The UI must not become a generic admin template or KPI card grid.

Use reusable primitives plus product-aware components. Favor enterprise patterns such as data tables, saved filters/views, split views, side panels, sticky actions, inline editing, bulk actions, comparison, timeline, pipeline/kanban, command menu, keyboard shortcuts, and evidence drill-down.

Dashboard is a Command Center—not a gallery of decorative metrics.

AI suggestions must expose provenance/evidence/confidence where meaningful and preserve human approval, override, and undo.

Internal product UI acceptance is defined in `docs/visual-product-target.md` and requires screenshots from the executable application, not generated mock images.

RTL/LTR readiness is a foundation requirement. Persian and English must both be supported.

---

# 20. API conventions

Baseline:

```text
REST
OpenAPI
versioned endpoint conventions
typed API client
Zod/shared validation where appropriate
structured errors
correlation/request ID
tenant context
authorization at service boundary
```

Do not expose database records directly as uncontrolled API contracts.

---

# 21. Testing strategy

Minimum layers:

```text
unit tests
service/domain tests
authorization tests
tenant-isolation tests
API integration tests
critical browser flows
AI contract/evaluation tests
interview reliability tests
```

For AI behavior, deterministic fixtures and evaluation datasets matter more than snapshotting prose. Persian interview testing must include mixed Persian-English technical speech.

---

# 22. Local developer setup strategy

## 22.1 Required initially

```text
VS Code
Git
Node.js 25.9.x
npm 11.6.x
PostgreSQL
Internet access to registry.npmjs.org
```

## 22.2 Installed when milestone requires it

```text
Python
Redis
pgvector
FFmpeg
whisper.cpp toolchain
LiveKit server
coturn
TTS runtime
Avatar/GPU dependencies
Temporal
```

## 22.3 Not required for current development

```text
Docker Desktop
Docker Compose
Kubernetes
MinIO
cloud deployment account
hosted STT/TTS/avatar services
```

---

# 23. Delivery order

```text
M0 Foundation
→ M1 Job → Candidate → Evidence vertical slice
→ M2 Sourcing + Talent
→ M3 Outreach + Screening + Scheduling
→ M4 AI Interview
→ M5 Assessments
→ M6 Analytics + Enterprise hardening
```

M0 establishes monorepo, web shell, API shell, local PostgreSQL, Drizzle, organization/user/membership, RBAC, audit, local filesystem StorageProvider, AI provider interfaces, Design System foundation, typed API client, and CI.

Redis, MinIO, Docker, Temporal, and realtime media are not required merely to complete early foundation work.

---

# 24. Architecture decision summary

Locked decisions:

```text
Modular monolith first
Candidate organization-global; Application job-specific
PostgreSQL primary system of record
Drizzle ORM
Evidence first
Deterministic final scoring
Human review for consequential decisions
Provider abstractions
pgvector before external vector DB
REST + OpenAPI first
Approved sourcing adapters
Audit from foundation
No unsupported biometric/personality inference
Candidate-facing and internal surfaces separated
Controlled Interview Brain
Interviewer/Evaluator separation
Avatar presentation-only
No mandatory per-minute media SaaS
Self-hosted interview media path
Laptop-first local-native development
Node.js 25.9.x + npm 11.6.x
npm workspaces + Turborepo
Public npm registry + deterministic committed package-lock.json
package-lock.json canonical JavaScript lockfile
NestJS runtime without Node-25-incompatible CLI/schematics
VS Code preferred development IDE
No Docker requirement during current implementation phase
Local filesystem storage during development
MinIO/S3 deferred behind StorageProvider
```

---

# 25. Change policy

Any future proposal that changes a locked decision should document:

1. the problem;
2. the proposed change;
3. alternatives considered;
4. migration impact;
5. security/privacy impact;
6. cost impact;
7. whether `projectstate.md` or `production-readiness.md` must also change.

The goal is not to preserve decisions forever. The goal is to prevent accidental architecture drift.
