# AI Recruiter Platform — MASTER

> **Status:** Architecture baseline approved for implementation  
> **Version:** 0.3.0  
> **Date:** 2026-08-31  
> **Purpose:** Single source of truth for product boundaries, engineering architecture, UX principles, AI behavior, security, data model, interview architecture, and delivery order.

---

## 0. How to use this document

This file is the stable contract for the project. Fast-changing execution state belongs in `projectstate.md`. Production release gates and the boundary for autonomous interviewing belong in `production-readiness.md`.

Any major architectural change must be reflected here and in `projectstate.md`.

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

The product is not just an ATS and not just a video interview tool. The differentiator is an AI recruiting agent that can execute the workflow up to a defensible shortlist while preserving human review for consequential decisions.

## 1.2 Primary outcomes

1. Reduce recruiter manual work.
2. Find relevant candidates faster.
3. Reuse internal/previous candidates.
4. Make screening and interviews consistent and job-specific.
5. Validate claimed skills using interview/assessment evidence.
6. Produce traceable candidate evaluation.
7. Reduce time-to-hire.
8. Keep consequential employment decisions human-reviewable.
9. Support Persian and English.
10. Support enterprise permissions, audit, privacy, retention, and integrations.

---

# 2. Non-negotiable principles

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

A score without evidence is incomplete.

## 2.4 Deterministic final scoring

LLMs can propose criterion-level evaluations. Final weighted scores are calculated by domain code from a versioned rubric. The LLM does not invent the final fit percentage.

## 2.5 Human-in-the-loop by default

- AI can suggest rejection, but generative judgment alone cannot silently reject a candidate.
- Hard eligibility filters may be automated only if explicitly configured and auditable.
- AI recommendations are reviewable/overridable.
- Score overrides require actor + reason + timestamp.
- Final hiring decisions remain human-controlled.

## 2.6 No unsupported psychological/biometric inference

Do not infer personality, honesty, emotional state, mental traits, confidence, or job suitability from facial appearance, gaze, body movement, accent, or other weak/non-defensible biometric signals.

Video is used for the interview experience, recording/replay, timestamped evidence, and session integrity where lawful—not pseudoscientific personality scoring.

## 2.7 Candidate experience is first-class

Candidate-facing flows require clear consent, device checks, recording disclosure, accessibility, understandable next steps, multilingual support, error recovery, and privacy information.

## 2.8 Interview automation has a release boundary

No interview mode is considered production-safe merely because the realtime demo works.

Autonomous interviewing is enabled only after the relevant combination of job family + language + rubric + interview mode passes `production-readiness.md`.

Every autonomous interview mode needs:

- versioned interview plan and rubric;
- explicit allowed/forbidden behaviors;
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
- recording/object storage.

Target variable vendor cost:

```text
LLM API            allowed / expected initially
STT API            not required
TTS API            not required
Avatar API         not required
RTC/media SaaS     not required
```

Infrastructure still has CPU/GPU, bandwidth, storage, hosting and operations cost.

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

The Interview Brain owns state, question strategy, follow-ups, evidence coverage, timing and policy. Avatar rendering only presents approved speech.

The Interviewer and Evaluator are also logically separate. The Interviewer optimizes the conversation. The Evaluator scores evidence against the rubric.

---

# 3. Human roles

| Role | Main responsibility |
|---|---|
| Recruiter | Jobs, sourcing, outreach, screening, pipeline, candidate review |
| HR Manager | Policy, approvals, oversight, reporting |
| Hiring Manager | Requirements, shortlist, comparison, final feedback |
| Interviewer | Assigned interviews/scorecards/evidence review |
| Organization Admin | Members, roles, integrations, privacy/settings |
| Candidate | Screening, scheduling, interview, assessment, consent |

AI actions must be represented as explicit machine actors in audit logs.

---

# 4. Product architecture

Top-level product areas:

```text
Home / Command Center
Jobs
Candidates
Talent
Interviews
Inbox / Outreach
Analytics
Automations
Integrations
Settings
```

Contextual capabilities should not pollute top-level navigation. Examples:

- Sourcing belongs inside Job workspace.
- Skill gap belongs in Candidate intelligence.
- Transcript/evidence belongs inside Interview/Candidate.
- Rubric belongs inside Job/Interview configuration.

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

Recruiter side:

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

## 5.1 Deployment model

Start as a modular monolith plus specialized workers.

```text
apps/web            Next.js / React / TypeScript
apps/api            NestJS modular monolith
services/ai-worker  AI/evaluation workloads
services/media-worker realtime speech/avatar/media workloads
packages/*          shared UI/types/validation/config/db clients
infra/*             docker/compose/deployment assets
```

Do not start with microservices.

## 5.2 Core stack

```text
Runtime              Node.js 24 LTS
Frontend             Next.js 16.3 line + React + TypeScript
Styling              Tailwind CSS
UI primitives         shadcn/ui-based internal design system
Server state          TanStack Query
Tables                TanStack Table
Forms                 React Hook Form + Zod
Small client state    Zustand
Backend               NestJS 12
AI/media workers      Python where advantageous
Database              PostgreSQL 18.x
ORM                   Drizzle ORM
Vector                pgvector
Cache/ephemeral       Redis
Workflow              Temporal
Object storage        S3-compatible / MinIO
Realtime media        LiveKit OSS self-hosted
TURN                   coturn
VAD                    Silero VAD
STT                    whisper.cpp baseline
TTS                    self-hosted provider interface; VITS-family benchmark baseline
Avatar                 self-hosted AvatarProvider; MuseTalk benchmark baseline
Observability          OpenTelemetry + structured logs + Sentry-compatible error tracking
CI/CD                  GitHub Actions
```

Exact model versions are pinned only after performance/license review.

---

# 6. Backend bounded modules

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

Business modules call capability interfaces. They must not directly lock the domain to a model/media vendor.

---

# 7. Repository shape

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
├─ infra/
│  ├─ docker/
│  └─ compose/
├─ master.md
├─ projectstate.md
├─ production-readiness.md
├─ package.json
├─ pnpm-workspace.yaml
└─ turbo.json
```

---

# 8. Core data model

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

## 8.1 Candidate identity

Candidate identity resolution may use email, phone, LinkedIn/profile URL where lawfully available, name/company/history and other signals. Ambiguous merges require review.

## 8.2 Application

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

# 9. Resume ingestion and matching

Resume pipeline:

```text
Upload
→ secure object storage
→ text extraction
→ structured parsing
→ experience/skills extraction
→ chunks
→ embeddings
→ evidence candidates
→ candidate profile update
```

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

# 10. Evidence architecture

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

# 11. Scoring architecture

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

Every override records previous value, new value, actor, reason and timestamp.

---

# 12. Sourcing

All sourcing is adapter-based:

```text
CandidateSourceAdapter
├─ InternalTalentPoolAdapter
├─ ATSAdapter
├─ ApprovedJobBoardAdapter
└─ ApprovedExternalSourceAdapter
```

Do not make unapproved platform scraping a core dependency.

Sourcing flow:

```text
Job
→ AI search strategy
→ human/policy approval where required
→ adapters
→ normalization
→ deduplication
→ matching
→ ranked discovered candidates
```

---

# 13. Outreach and candidate conversation

Core entities:

```text
Conversation
Message
Sequence
Template
Campaign
CandidateContact
```

Candidate-facing answers about salary, remote policy, benefits, process, etc. must be grounded in approved company/job knowledge.

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

Use Temporal for long-running workflows such as:

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

Do not model multi-day orchestration as fragile cron chains and boolean flags.

---

# 15. AI Interview architecture

## 15.1 Core loop

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

## 15.2 Interview Planner

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

## 15.3 Dialogue Engine

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

## 15.4 Structured turn contract

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

## 15.5 Interview state

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

## 15.6 Interviewer vs Evaluator

```text
AI Interviewer
→ asks good questions and manages dialogue

AI Evaluator
→ independently evaluates collected evidence against rubric
```

Separate prompts/traces/roles.

## 15.7 Avatar strategy

Do not pre-record one MP4 per question.

Baseline approach:

```text
professionally recorded actor idle/listening assets
+ local generated speech
+ realtime lip-sync/avatar rendering
→ live digital interviewer
```

The actor likeness/voice requires explicit commercial rights and consent.

`AvatarProvider` abstraction must allow replacing MuseTalk if benchmarks or licensing require it.

## 15.8 Failure behavior

Avatar is not a single point of failure.

```text
avatar fails      → continue voice-only
TTS failure       → retry / fallback local engine
LLM timeout       → retry / safe controlled fallback
STT low confidence→ ask candidate to repeat
WebRTC disconnect → reconnect and resume checkpoint
browser crash     → resume session when policy allows
```

---

# 16. Assessments

Coding assessment:

```text
Question
→ browser code editor
→ submission
→ isolated runner
→ test cases
→ static/runtime signals
→ AI evidence analysis
→ rubric score
```

Never execute untrusted candidate code inside the core API process.

System-design assessments may use a node/edge canvas and structured explanation.

---

# 17. Analytics

Primary recruitment events:

```text
candidate.discovered
candidate.contacted
candidate.responded
candidate.screened
candidate.interviewed
candidate.assessed
candidate.shortlisted
candidate.rejected
candidate.hired
```

Initial analytics can use PostgreSQL. Add a dedicated analytical store only when measured load justifies it.

Metrics include funnel conversion, stage duration, time-to-hire, source quality, recruiter workload, interview load, AI quality/calibration, and cost.

---

# 18. Security, privacy and governance

Required from the beginning:

- tenant isolation;
- RBAC/permission checks;
- least privilege;
- encrypted transport;
- secure object storage;
- consent records;
- recording policy;
- retention/deletion policy;
- audit trails;
- AI provenance;
- secrets management;
- log redaction for sensitive data;
- deletion of derived artifacts/vector representations when policy requires it.

Audit examples:

```text
candidate.stage_changed
candidate.score_overridden
candidate.rejected
job.rubric_changed
interview.started
interview.completed
ai.recommendation_reviewed
consent.recorded
retention.deletion_executed
```

---

# 19. UI/UX architecture

The UI is not an admin-template card grid.

Design for data-dense enterprise workflows using:

- advanced tables;
- master-detail/split views;
- contextual side panels;
- saved views;
- advanced filters;
- bulk actions;
- inline editing;
- command/search patterns;
- pipeline views;
- timelines;
- compare mode;
- evidence blocks;
- sticky contextual actions.

The Home page is a Command Center, not just KPI cards.

Candidate Profile is a Candidate Intelligence Workspace.

AI UI patterns must consistently show what AI did, why, evidence, confidence where meaningful, approval state, and override controls.

---

# 20. Design system

Primitive components:

```text
Button
IconButton
Input
Textarea
Select
Combobox
MultiSelect
Badge
StatusBadge
Avatar
Tooltip
Dialog
Drawer
Popover
Dropdown
Tabs
SegmentControl
Table/DataGrid
EmptyState
Skeleton
Pagination
SearchBar
FilterBuilder
SavedView
PageHeader
WorkspaceHeader
SidePanel
SplitView
Timeline
ActivityItem
```

Domain components:

```text
CandidateRow
CandidateCard
JobHeader
MatchScore
SkillChip
SkillMatrix
CandidateStage
AIRecommendation
EvidenceBlock
Scorecard
InterviewMoment
PipelineColumn
PipelineCandidate
ConfidenceIndicator
RiskBadge
```

---

# 21. API conventions

- REST + OpenAPI first.
- Generate typed API clients.
- Validate inputs at boundaries.
- Use stable IDs.
- Cursor pagination for large collections where appropriate.
- Every consequential mutation performs authorization + audit.
- Idempotency for externally retried operations.
- Domain services own business invariants.

---

# 22. Testing

Required layers:

```text
unit
integration
API contract
database migration
permission/tenant isolation
AI structured-output tests
prompt/evaluation regression
browser E2E
realtime interview integration
failure/reconnect tests
load tests
security tests
```

AI tests must include fixed evaluation datasets rather than relying only on manual prompting.

---

# 23. Observability

Track:

```text
request latency/error rate
workflow failures
LLM latency/cost/fallback
STT latency/confidence
TTS latency
avatar render latency
realtime reconnects
interview completion rate
transcription failure rate
GPU utilization
TURN bandwidth
object-storage growth
```

All significant workflows use correlation IDs.

---

# 24. Delivery milestones

## M0 — Foundation

- monorepo bootstrap;
- local Docker infrastructure;
- web/API baseline;
- PostgreSQL/Redis/object storage;
- organization/user/RBAC;
- tenant context;
- audit foundation;
- AI Gateway interfaces;
- design tokens/app shell;
- CI.

## M1 — Job → Candidate → Evidence vertical slice

- Job creation + AI Job Builder;
- requirements/skills/seniority;
- versioned rubric;
- candidate + CV ingestion;
- resume parsing;
- Application;
- matching;
- evidence records;
- pipeline;
- deterministic scoring;
- human review;
- candidate compare/shortlist.

## M2 — Sourcing + Talent

- source adapters;
- sourcing runs;
- deduplication;
- internal talent rediscovery;
- talent pools.

## M3 — Outreach + Screening + Scheduling

- inbox/conversations;
- templates/sequences;
- approved knowledge answers;
- structured screening;
- eligibility rules;
- calendar integration;
- Temporal workflows.

## M4 — AI Interview

- candidate invite/consent/device check;
- LiveKit OSS + coturn;
- Silero VAD;
- local STT benchmark/integration;
- local Persian/English TTS benchmark/integration;
- actor/avatar asset pipeline and rights checklist;
- self-hosted AvatarProvider benchmark;
- Interview Planner + Dialogue Engine;
- structured turn contract;
- interruption/clarification handling;
- separate Interviewer/Evaluator;
- transcript/recording/evidence/key moments;
- recruiter review UI;
- latency/load benchmark;
- no paid media/STT/TTS/avatar credentials required.

## M5 — Assessments

- coding environment + isolated runner;
- system-design canvas;
- domain assessments;
- assessment versioning;
- anti-cheating/risk signals for human review.

## M6 — Analytics + enterprise hardening

- funnel analytics;
- time/cost/source KPIs;
- AI quality analytics;
- SSO/SCIM as required;
- API/webhooks;
- ATS/HRMS integrations;
- retention/governance;
- enterprise audit export.

---

# 25. Explicit early non-goals

Do not block early milestones on:

- unapproved LinkedIn scraping;
- photorealistic full-generative avatar;
- facial emotion/personality analysis;
- full HRMS;
- analytics warehouse;
- microservices/Kubernetes;
- custom vector database;
- every ATS integration;
- native mobile apps.

---

# 26. Baseline ADRs

## ADR-001 — Modular monolith first
NestJS modular monolith for business API; specialized workers separate.

## ADR-002 — PostgreSQL is system of record
Highly relational domain requires transactions and auditability.

## ADR-003 — pgvector before separate vector DB
Use PostgreSQL FTS + pgvector until measured scale requires otherwise.

## ADR-004 — Drizzle ORM
Type-safe PostgreSQL access with explicit SQL/index/vector control.

## ADR-005 — Evidence-backed evaluation
Evidence is first-class and important AI evaluation should reference it.

## ADR-006 — Deterministic final score
Final weighted scoring occurs in domain code, not generative output.

## ADR-007 — Provider abstractions
Business modules call capability interfaces rather than model/media vendors directly.

## ADR-008 — LiveKit OSS for realtime interview media
Self-hosted realtime media foundation.

## ADR-009 — Temporal for long-running recruiting workflows
Use durable workflows for days/weeks of waits, retries and human signals.

## ADR-010 — REST + OpenAPI first
Typed REST contract with generated client.

## ADR-011 — No unsupported biometric/personality inference
Raw appearance/body cues are not used for psychological suitability scoring.

## ADR-012 — No unapproved source scraping
Sourcing occurs through explicit organization-approved source adapters.

## ADR-013 — No mandatory usage-metered media SaaS
Self-host RTC/TURN/VAD/STT/TTS/avatar; paid LLM API allowed initially.

## ADR-014 — Interview Brain independent from AvatarProvider
Question strategy/state cannot depend on digital-human vendor.

## ADR-015 — Interviewer and Evaluator are separate logical agents
Conversation and scoring are independently testable and traceable.

## ADR-016 — Initial self-hosted realtime baseline
Benchmark LiveKit OSS + coturn + Silero VAD + whisper.cpp + self-hosted VITS-family TTS + MuseTalk. Pin exact models only after performance/license review.

## ADR-017 — Autonomous interviewing is gated
Internal test → shadow evaluation → supervised pilot → controlled production → scaled production. `production-readiness.md` is the release authority.

---

# 27. Feature Definition of Done

A feature is not done because the happy-path page renders.

Verify:

- role + permission behavior;
- tenant isolation;
- loading/empty/error/processing/success states;
- audit where consequential;
- AI provenance/evidence where applicable;
- human override where applicable;
- notifications/workflow triggers;
- analytics events;
- privacy/retention impact;
- accessibility;
- Persian/English/RTL-LTR implications;
- responsive behavior;
- API contract;
- automated tests;
- observability;
- documentation.

---

# 28. Open product/business decisions

1. Initial target market/jurisdiction.
2. Production cloud/region and data residency.
3. Identity provider / first-release SSO requirements.
4. Approved external candidate/job-board sources.
5. Outbound communication channels.
6. Default candidate-data retention.
7. Recording mandatory/optional/configurable policy.
8. First job families for launch.
9. Default Persian/English and RTL/LTR strategy.
10. Compensation-data policy for candidate AI chat.
11. Target GPU and expected concurrent interviews.
12. Final Persian TTS model.
13. Actor voice/likeness commercial contract.
14. Final avatar model/version.
15. Final Whisper model/quantization.

---

# 29. Project control documents

```text
master.md
→ stable product + architecture contract

projectstate.md
→ current execution state + milestones + decisions

production-readiness.md
→ evidence required before real customers can safely delegate interviews
```

A feature can be technically complete while not production-approved.

---

# 30. Final implementation rule

When speed conflicts with foundation, protect these first:

```text
1. Tenant isolation
2. Evidence provenance
3. Versioned rubrics/scoring
4. Human review + audit
5. Candidate/application identity integrity
```

Visual polish, extra automation and integrations can iterate later. Corrupting these foundations is expensive to repair.
