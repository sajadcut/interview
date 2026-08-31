# AI Recruiter Platform — MASTER

> **Status:** Architecture baseline approved for implementation  
> **Version:** 0.4.0  
> **Date:** 2026-08-31  
> **Purpose:** Single source of truth for product boundaries, engineering architecture, UX principles, AI behavior, security, data model, interview architecture, development environment, and delivery order.

---

## 0. How to use this document

This file is the stable architecture contract for the project.

- `master.md` defines stable product and technical architecture.
- `projectstate.md` defines current execution state, tickets, risks, and open decisions.
- `production-readiness.md` defines the gates for safe real-candidate autonomous interviewing.

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

Autonomous interviewing is enabled only after the relevant combination of job family, language, rubric, and interview mode passes `production-readiness.md`.

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

The core interview path must have a commercially usable self-hosted implementation for:

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

Infrastructure still has CPU/GPU, bandwidth, storage, hosting, and operations cost.

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
Local TTS
        ↓
Avatar Renderer
        ↓
Candidate
```

The Interview Brain owns state, question strategy, follow-ups, evidence coverage, timing, and policy. Avatar rendering only presents approved speech.

The AI Interviewer and AI Evaluator are logically separate. The Interviewer optimizes the conversation. The Evaluator scores evidence against the rubric.

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

Typical entry:

```text
Secure invitation / magic link
→ identity verification when required
→ consent
→ device check
→ screening / interview / assessment
→ completion
```

Candidate users do not enter the internal HR application.

---

# 4. Product architecture

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
Question strategy
Session
Transcript
Evidence
Scorecard
Key Moments
Decision support
```

---

# 5. Technical architecture

## 5.1 Architecture style

Start as a modular monolith plus specialized workers.

```text
apps/web                Next.js / React / TypeScript
apps/api                NestJS modular monolith
services/ai-worker      AI/evaluation workloads
services/media-worker   realtime speech/avatar/media workloads
packages/*              shared UI/types/validation/config/db clients
```

Do not start with microservices.

## 5.2 Development environment — LOCAL NATIVE BASELINE

**Current development is laptop-first and local-native. Docker is not required for day-to-day development.**

The intended workstation flow is:

```text
Laptop
└─ VS Code
   ├─ Node.js 24 LTS
   ├─ pnpm 11
   ├─ Git
   ├─ PostgreSQL installed locally
   ├─ Python installed locally when AI/media work begins
   ├─ Redis installed locally only when a feature actually requires it
   ├─ pgvector installed when candidate semantic matching begins
   └─ project processes started directly from terminals/tasks
```

Development commands should work without Docker Desktop, Docker Compose, Kubernetes, or MinIO.

### Local development principles

1. Prefer direct installation of required developer tools on the laptop.
2. Do not introduce Docker solely for convenience during the current implementation stage.
3. Add a local service only when the current milestone requires it.
4. Keep service interfaces deployment-independent so local implementations can later be replaced by production implementations.
5. Development simplicity must not leak laptop-specific assumptions into domain code.

### Intended local process layout

```text
VS Code
├─ Terminal: pnpm dev:web       → Next.js
├─ Terminal: pnpm dev:api       → NestJS
├─ PostgreSQL local service
├─ Redis local service          → only when needed
├─ Python ai-worker             → when needed
└─ Python media-worker          → when interview work begins
```

VS Code is the preferred IDE for the current development phase, but the repository must not depend on editor-specific proprietary behavior.

## 5.3 Production/deployment portability

Docker/containerization is **deferred**, not rejected.

When deployment work begins, the architecture may add:

```text
Dockerfiles
Docker Compose for reproducible environments where useful
container registry
production process manager/orchestrator
GPU worker containers
cloud deployment definitions
```

These are deployment concerns and are not prerequisites for current laptop development.

## 5.4 Core stack

```text
Runtime              Node.js 24 LTS
Package manager      pnpm 11
Frontend             Next.js 16.3 line + React + TypeScript
Styling              Tailwind CSS
UI primitives         shadcn/ui-based internal design system
Server state          TanStack Query
Tables                TanStack Table
Forms                 React Hook Form + Zod
Small client state    Zustand
Backend               NestJS 12
AI/media workers      Python where advantageous
Database              PostgreSQL 18.x, local during development
ORM                   Drizzle ORM
Vector                pgvector, introduced when matching requires it
Cache/ephemeral       Redis, introduced when feature requirements justify it
Workflow              Temporal, introduced when long-running workflows require it
Object storage        StorageProvider abstraction; local filesystem in development
Realtime media        LiveKit OSS self-hosted when realtime interview work begins
TURN                   coturn when remote WebRTC/NAT traversal requires it
VAD                    Silero VAD baseline
STT                    whisper.cpp baseline
TTS                    self-hosted provider interface; VITS-family benchmark baseline
Avatar                 self-hosted AvatarProvider; MuseTalk benchmark baseline
Observability          OpenTelemetry + structured logs; error tracking added as needed
CI/CD                  GitHub Actions
IDE                    VS Code preferred for current local development
```

Exact model versions are pinned only after performance and license review.

---

# 6. Storage architecture

## 6.1 StorageProvider abstraction

Business modules must not depend directly on MinIO, AWS S3, or the local filesystem.

Use a capability interface conceptually similar to:

```text
StorageProvider
├─ put(file, metadata)
├─ get(key)
├─ delete(key)
├─ exists(key)
└─ createReadReference(key)
```

## 6.2 Development storage

For the current laptop development phase:

```text
LocalFilesystemStorageAdapter
→ .local-data/storage/
```

Examples stored locally during development:

- sample CVs;
- candidate attachments;
- test audio;
- test video;
- generated interview artifacts.

The local storage directory is ignored by Git.

Do not require MinIO for M0/M1 development.

## 6.3 Production storage

Production will use a durable object-storage implementation behind the same interface, such as:

```text
S3StorageAdapter
or
S3CompatibleStorageAdapter
```

MinIO remains an optional S3-compatible implementation for future self-hosted environments; it is **not the current development baseline**.

Production storage must support retention/deletion policy, access control, encryption strategy, auditability, and large video/audio objects.

---

# 7. Backend bounded modules

Initial NestJS modules:

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

Business modules call capability interfaces. They must not directly lock the domain to a model, storage, media, or infrastructure vendor.

---

# 8. Repository shape

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
├─ infra/                  reserved for future deployment assets
├─ master.md
├─ projectstate.md
├─ production-readiness.md
├─ AGENTS.md
├─ package.json
├─ pnpm-workspace.yaml
└─ turbo.json
```

`infra/` may remain empty during the local-native development phase. Docker/Compose files are not required to satisfy repository foundation work.

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

## 9.1 Candidate identity

Candidate identity resolution may use email, phone, LinkedIn/profile URL where lawfully available, name/company/history, and other signals. Ambiguous merges require review.

## 9.2 Application

`Application` is the relationship between Candidate and Job and owns job-specific lifecycle state:

```text
candidate_id
job_id
stage_id
source
owner
status
match state
screening/interview/assessment references
final decision state
```

---

# 10. Resume ingestion and matching

Resume pipeline:

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

During laptop development, uploaded documents may be stored through `LocalFilesystemStorageAdapter`.

Candidate matching is not cosine similarity converted into a percentage.

A match score combines explicit domain signals such as:

- must-have skills;
- relevant experience;
- seniority;
- domain/context relevance;
- verified skills;
- screening/assessment/interview evidence where available.

Vector search is a retrieval signal, not the final business score.

---

# 11. Evidence architecture

Evidence is first-class.

Example:

```text
Skill: Kubernetes
Evaluation: Advanced

Evidence:
- Resume p4: production cluster responsibility
- Interview 14:21: rollout/rollback explanation
- Interview 18:02: CrashLoopBackOff troubleshooting
- Assessment: 8.4/10
```

Evidence should support deep links to source material and timestamps where possible.

---

# 12. Scoring architecture

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

# 13. Sourcing architecture

All sourcing is adapter-based:

```text
CandidateSourceAdapter
├─ InternalTalentPoolAdapter
├─ ATSAdapter
├─ ApprovedJobBoardAdapter
└─ ApprovedExternalSourceAdapter
```

Do not make hidden or unapproved platform scraping a core dependency.

Sourcing flow:

```text
Job
→ AI search strategy
→ query expansion
→ human/policy approval where required
→ source adapters
→ normalization
→ identity resolution / deduplication
→ matching
→ ranked discovered candidates
```

Vector retrieval, keyword search, and structured filters may contribute to discovery, but business fit is computed separately.

---

# 14. Outreach and candidate conversation

Core entities:

```text
Conversation
Message
Sequence
Template
Campaign
CandidateContact
```

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

# 15. Workflow orchestration

Temporal is intended for long-running workflows such as:

```text
Candidate found
→ wait for approval
→ outreach
→ wait for response
→ follow-up
→ screening
→ scheduling
→ interview
→ evaluation
→ manager review
```

Temporal is **not required during the first repository/database foundation steps**. Introduce it when real multi-step waits, retries, and human signals appear.

Do not model multi-day orchestration as fragile cron chains and boolean flags.

---

# 16. AI Interview architecture

## 16.1 Core loop

```text
Candidate microphone
→ LiveKit OSS
→ Silero VAD
→ local STT
→ transcript
→ Interview Brain
→ paid LLM call
→ structured turn
→ local TTS
→ local Avatar renderer
→ LiveKit audio/video
→ Candidate
```

No mandatory hosted STT/TTS/avatar/media provider credentials are required.

During early development, individual interview components may be run directly on the laptop without containers. GPU-heavy avatar work may later move to a dedicated machine while preserving the same interfaces.

## 16.2 Interview Planner

Builds an interview plan from:

```text
Job
Rubric
Seniority
Resume/Candidate history
Interview template
Time budget
Organization policy
```

Each rubric criterion has evidence objectives.

Example:

```text
Criterion: Kubernetes
Goal: verify real production experience
Evidence objectives:
- deployment
- troubleshooting
- scaling
- failure recovery
```

## 16.3 Dialogue Engine

Questions form a controlled graph/state machine, not a static list and not a free LLM chat.

```text
Base question
├─ weak answer   → clarify / probe
├─ medium answer → evidence follow-up
└─ strong answer → deeper scenario
```

Supported actions include:

```text
ASK
CLARIFY
PROBE
PROBE_DEPTH
SCENARIO
MOVE_ON
ANSWER_CANDIDATE_CLARIFICATION
SKIP
CLOSE
```

## 16.4 Structured turn contract

The LLM should return structured output similar to:

```json
{
  "action": "probe",
  "criterion": "kubernetes",
  "objective": "production_debugging",
  "spoken_text": "یک نمونه از مشکلی که در production با Kubernetes داشتی تعریف می‌کنی؟",
  "reason": "debugging evidence missing",
  "expected_evidence": ["logs", "events", "metrics", "root cause"]
}
```

Only approved `spoken_text` is sent to TTS/avatar.

## 16.5 Interview state

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

## 16.6 Interviewer vs Evaluator

```text
AI Interviewer
→ asks good questions and manages dialogue

AI Evaluator
→ independently evaluates collected evidence against rubric
```

Separate prompts/traces/roles are required for meaningful production evaluation.

## 16.7 Digital human

Avatar is presentation only.

```text
Interview Brain
→ spoken_text
→ TTSProvider
→ AvatarProvider
→ media output
```

Baseline research path:

- professionally recorded actor assets;
- commercially licensed/owned likeness and voice rights;
- local TTS;
- MuseTalk-family realtime lip-sync benchmark;
- voice-only fallback.

Do not architect the interview as `question → prerecorded mp4`.

---

# 17. Assessments

Coding assessment architecture:

```text
Question
→ Web editor
→ Submission
→ isolated runner
→ tests
→ structured result
→ AI evidence analysis
→ rubric score
```

Candidate code must never execute directly inside the core API process.

System-design and role-specific assessments use versioned prompts/tasks and versioned rubrics.

---

# 18. Analytics

Recruiting activity emits domain events such as:

```text
candidate.discovered
candidate.contacted
candidate.screened
candidate.interviewed
candidate.rejected
candidate.hired
```

Initial analytics may use PostgreSQL. Introduce a dedicated analytics store only after measured volume justifies it.

Core metrics include:

- pipeline conversion;
- stage duration;
- time-to-hire;
- source quality;
- outreach response;
- interview completion;
- human/AI calibration;
- low-confidence rate;
- false-rejection analysis.

---

# 19. Security, privacy, and governance

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

# 20. Frontend and Design System principles

The UI must not become a generic admin template or card grid.

Use reusable primitives plus domain components.

Primitives include:

```text
Button
Input
Combobox
Dialog
Drawer
Popover
Tabs
DataTable
FilterBuilder
SavedView
SplitView
Timeline
EmptyState
Skeleton
```

Product-aware components include:

```text
CandidateRow
CandidateHeader
JobHeader
MatchScore
SkillMatrix
EvidenceBlock
AIRecommendation
Scorecard
InterviewMoment
PipelineColumn
ActivityItem
RiskPanel
```

Candidate and Job workflows should favor data-dense patterns such as advanced tables, split views, contextual side panels, saved filters, bulk actions, and evidence drill-down.

---

# 21. API conventions

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

# 22. Testing strategy

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

For AI behavior, deterministic fixtures and evaluation datasets are more important than only snapshotting prose.

Persian interview testing must include mixed Persian-English technical speech.

---

# 23. Local developer setup strategy

## 23.1 Required initially

```text
VS Code
Git
Node.js 24 LTS
pnpm 11
PostgreSQL
```

## 23.2 Installed when milestone requires it

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

Do not install all infrastructure on day one merely because it may be needed later.

## 23.3 Not required for current development

```text
Docker Desktop
Docker Compose
Kubernetes
MinIO
cloud deployment account
hosted STT/TTS/avatar services
```

---

# 24. Delivery order

```text
M0 Foundation
→ M1 Job → Candidate → Evidence vertical slice
→ M2 Sourcing + Talent
→ M3 Outreach + Screening + Scheduling
→ M4 AI Interview
→ M5 Assessments
→ M6 Analytics + Enterprise hardening
```

### M0 local-native interpretation

M0 should establish:

```text
monorepo
web shell
API shell
local PostgreSQL
Drizzle
organization/user/membership
RBAC
audit
local filesystem StorageProvider
AI provider interfaces
Design System foundation
typed API client
CI
```

Redis, MinIO, Docker, Temporal, and realtime media are not required merely to complete early foundation work unless a specific feature makes them necessary.

---

# 25. Architecture decision summary

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
Local-native laptop development baseline
VS Code preferred development IDE
No Docker requirement during current implementation phase
Local filesystem storage during development
MinIO/S3 deferred behind StorageProvider
```

---

# 26. Change policy

Any future proposal that changes one of the locked decisions should document:

1. the problem;
2. the proposed change;
3. alternatives considered;
4. migration impact;
5. security/privacy impact;
6. cost impact;
7. whether `projectstate.md` or `production-readiness.md` must also change.

The goal is not to preserve decisions forever. The goal is to prevent accidental architecture drift.
