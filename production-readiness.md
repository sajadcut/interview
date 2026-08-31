# AI Recruiter Platform — PRODUCTION READINESS

> **Status:** Release-gate specification defined; validation not started  
> **Version:** 0.1.0  
> **Date:** 2026-08-31  
> **Purpose:** Define the evidence required before a real customer may safely delegate candidate interviews to the system.

---

# 1. Why this document exists

A working realtime avatar demo is not evidence that the product is safe or reliable enough to run real employment interviews.

Production approval requires proof that the system can:

1. run a consistent job-relevant interview;
2. adapt follow-up questions without leaving policy boundaries;
3. preserve the candidate experience during failures;
4. capture accurate transcripts/evidence;
5. produce evaluation that is calibrated against qualified human evaluators;
6. avoid unacceptable false rejection/promotion behavior;
7. support human review and audit;
8. operate securely and reliably at expected load;
9. respect privacy, consent and applicable employment-AI rules;
10. do this with acceptable unit economics.

This document is the release authority for autonomous interview modes.

---

# 2. Product promise and safety boundary

The production promise is:

> The platform can conduct structured screening and job-specific interviews, collect evidence, prepare scorecards and recommendations, and route important/uncertain cases to humans.

The promise is **not**:

> AI independently makes final hiring decisions.

Allowed after validation:

```text
consent/device check
structured screening interview
job-specific technical interview
adaptive follow-up
candidate clarification handling
transcript
recording when policy allows
evidence extraction
criterion scorecard draft
candidate summary
shortlist recommendation
```

Human-controlled:

```text
final hiring decision
final rejection solely from generative judgment
policy exceptions
unsupported personality/emotion/biometric suitability inference
```

---

# 3. Release unit

Production approval is not granted globally to “the AI interviewer”.

Approval is scoped to a release unit:

```text
job_family
+ language
+ interview_type
+ rubric_version_family
+ interviewer_policy_version
+ STT/TTS/avatar stack version
+ evaluator version
```

Example:

```text
Software Engineering / Backend
Persian
Technical Screening
backend-senior rubric family
interviewer-policy v1
speech-stack v1
evaluator v3
```

A major change to any critical element can require partial or full recalibration.

---

# 4. Production lifecycle

Use staged rollout:

```text
DEV_ONLY
   ↓
INTERNAL_TEST
   ↓
SHADOW
   ↓
SUPERVISED_PILOT
   ↓
CONTROLLED_PRODUCTION
   ↓
SCALED_PRODUCTION
```

Any severe regression may move the capability to:

```text
SUSPENDED
```

---

# 5. Stage definitions

## 5.1 DEV_ONLY

Purpose: engineering functionality.

Allowed:

- synthetic/test candidates;
- internal developers;
- controlled test scripts;
- model and infrastructure spikes.

Not allowed:

- unsupervised real customer candidate interviews.

Exit requirements:

- core interview loop works;
- session persistence/reconnect implemented;
- structured turn contract implemented;
- transcript/evidence pipeline exists;
- known failures are observable.

## 5.2 INTERNAL_TEST

Purpose: validate experience and reliability with internal/consenting testers.

Requirements:

- consent UX;
- device check;
- privacy/recording states;
- failure fallbacks;
- basic latency telemetry;
- evaluator trace;
- interview replay.

Exit requires no unresolved blocker in candidate experience or interview policy.

## 5.3 SHADOW

Purpose: compare AI evaluation to qualified human evaluation without letting AI control the decision.

Typical pattern:

```text
Human interview/evaluation
        +
AI transcript/evidence/evaluation
        ↓
Independent comparison
```

The AI result must not be used as the sole decision authority.

Required outputs:

- criterion-level agreement analysis;
- ranking agreement;
- false rejection analysis;
- false promotion analysis;
- low-confidence analysis;
- disagreement root-cause analysis.

## 5.4 SUPERVISED_PILOT

Purpose: system conducts real candidate interviews, but trained human review is mandatory.

Requirements:

- customer explicitly understands pilot status;
- every interview has review ownership;
- AI cannot silently issue final rejection;
- candidate support/escalation exists;
- incident response path exists;
- production security baseline is active.

## 5.5 CONTROLLED_PRODUCTION

Purpose: validated interview mode can run without synchronous human supervision, while consequential decisions remain reviewable.

Requirements:

- all mandatory gates in this document passed;
- named production owner;
- production approval record;
- SLOs/alerts active;
- rollback/suspend mechanism;
- ongoing quality sampling.

## 5.6 SCALED_PRODUCTION

Purpose: larger volume and more customers/job families.

Additional requirements:

- capacity/load evidence;
- multi-tenant operational evidence;
- periodic recalibration;
- automated drift monitoring where possible;
- expanded incident and governance procedures.

---

# 6. Gate A — Interview relevance and consistency

The interview must collect evidence for the actual rubric rather than simply sounding conversational.

Required evidence:

- versioned InterviewPlan;
- versioned rubric;
- evidence objectives per important criterion;
- bounded question/follow-up strategies;
- maximum/minimum interview time policy;
- candidate clarification behavior;
- skip behavior;
- forbidden-question policy;
- consistent coverage measurements.

Pass conditions should demonstrate that materially similar candidates receive comparable coverage while allowing relevant adaptive depth.

Failure examples:

- LLM spends most time on a single interesting topic and misses required criteria;
- follow-up questions drift away from job relevance;
- interviewer gives candidates the answer;
- sensitive/non-job-relevant questions appear;
- interview ends without enough evidence for major criteria.

---

# 7. Gate B — Interviewer control

The LLM is not allowed unrestricted behavior.

Every turn must map to an allowed action such as:

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

Structured turn output must include sufficient metadata for audit/testing.

Example:

```json
{
  "action": "probe",
  "criterion": "system_design",
  "objective": "failure_handling",
  "spoken_text": "اگر consumer بعد از انجام کار ولی قبل از ack کردن پیام crash کند چه می‌شود؟",
  "reason": "reliability evidence missing"
}
```

Required tests:

- invalid model output;
- prompt injection from candidate speech;
- candidate asks AI to reveal answer;
- candidate asks interviewer to change grading criteria;
- candidate changes subject repeatedly;
- malicious/abusive input;
- ambiguity/clarification;
- skip/request-to-end;
- interruption.

---

# 8. Gate C — Transcript and speech quality

Speech quality is a critical production risk, particularly for Persian + English technical code-switching.

Required benchmark set includes:

- Persian only;
- Persian with English technical terms;
- English only;
- different speaking speeds;
- common regional accent variation where product is targeted;
- consumer laptop microphones;
- headset microphones;
- background noise;
- unstable network/reconnect scenarios;
- names/company names/technology names;
- numbers/years/version strings.

Track at least:

```text
word error / transcription error metrics
critical-term error rate
manual correction rate
STT latency
low-confidence frequency
repeat-question frequency caused by STT
```

Critical errors matter more than generic WER. Misreading `Kafka`, `Kubernetes`, `Redis`, years of experience, salary values or negation can change evaluation.

Low-confidence speech must trigger a safe behavior such as clarification/repeat rather than silently scoring corrupted text.

---

# 9. Gate D — TTS and avatar experience

The avatar is not required to fool candidates into believing it is human. The target is a professional, respectful and low-friction digital interviewer.

Required checks:

- Persian pronunciation quality;
- English technical-term pronunciation within Persian speech;
- natural speaking pace;
- audio/video synchronization;
- lip-sync stability;
- no unacceptable visual artifacts;
- avatar interruption response;
- voice-only fallback;
- transparency that interviewer is AI;
- actor likeness/voice commercial rights.

Avatar failure cannot invalidate the interview.

Fallback:

```text
avatar degraded/unavailable
→ preserve audio interview
→ preserve transcript/state
→ flag session telemetry
```

---

# 10. Gate E — Realtime latency

Measure the whole conversational turn and every component:

```text
candidate end-of-turn detection
VAD/endpointing
STT finalization
Interview Brain decision
LLM response
TTS first audio
avatar first render
media delivery
```

Track median and tail latency (p95/p99 where sample size supports it).

Set production thresholds only after real target hardware/network benchmarks. Do not invent a target without measurement.

User testing must confirm that pauses do not make the interview materially confusing or frustrating.

---

# 11. Gate F — Reliability and recovery

Required failure tests:

```text
browser refresh
browser crash
candidate disconnect
short network loss
long network loss
TURN-only connectivity
LLM timeout
LLM invalid structured output
STT process failure
TTS process failure
avatar process failure
GPU worker restart
API restart
database transient failure
object-storage failure
```

Expected principles:

- checkpoint interview state;
- avoid duplicate questions after retries where possible;
- idempotent persistence for turn/evidence writes;
- reconnect/resume flow;
- safe voice-only fallback if avatar fails;
- visible candidate guidance;
- no silent loss of recorded answers;
- operator visibility into degraded sessions.

Track interview completion rate and failure-caused abandonment.

---

# 12. Gate G — Evidence quality

Important criterion scores must be supported by evidence.

Evidence quality review samples should verify:

- correct source;
- correct candidate;
- correct criterion;
- faithful quotation/paraphrase;
- correct timestamp;
- enough context;
- no fabricated evidence;
- no evidence from another candidate/session;
- contradiction handling.

Example expected UX:

```text
Kubernetes — Advanced

Resume
Production Kubernetes responsibility

Interview 14:21
Explains rollout/rollback strategy

Interview 18:02
Troubleshoots CrashLoopBackOff

Concern 23:12
Weak cluster-networking explanation
```

---

# 13. Gate H — Evaluator calibration

This is one of the most important release gates.

Build a calibration dataset with qualified human evaluations.

For each sample capture:

```text
rubric criterion
human score(s)
human evidence
AI score
AI evidence
final adjudicated reference when available
```

Analyze:

- criterion-level agreement;
- score delta distribution;
- ranking correlation where meaningful;
- agreement at pass/review boundaries;
- disagreement patterns;
- confidence calibration;
- job-family-specific variance;
- language-specific variance.

A high overall correlation is insufficient if the system is consistently wrong on a critical criterion.

Human evaluators should also have a documented rubric; otherwise disagreement cannot automatically be treated as AI error.

---

# 14. Gate I — False rejection / false promotion

Measure decision-support errors separately.

## False rejection concern

Qualified candidate is scored/ranked low enough that they may be missed.

Investigate:

```text
bad STT
bad question coverage
incorrect resume extraction
missing evidence
bad evaluator
bad rubric weights
confidence ignored
```

## False promotion concern

Weak candidate is ranked too strongly.

Investigate:

```text
shallow follow-up
resume claims treated as verified
memorized generic answers
missing contradiction detection
rubric/evaluator weakness
```

Production thresholds must be explicitly approved for the specific use case; do not hide these errors inside one average score.

---

# 15. Gate J — Fairness and defensibility

The system must evaluate job-relevant evidence, not proxies unrelated to work requirements.

Forbidden by product policy:

```text
personality from face
honesty from facial expression
automatic confidence from eye contact
stress/emotion suitability from face/body
accent-based suitability
appearance-based scoring
```

Required fairness review should examine whether error rates or evaluation behavior differ materially across relevant tested groups where lawful/appropriate to measure.

The product must support human override, decision audit, rubric versioning and candidate-data governance.

Legal/compliance requirements are jurisdiction-specific and must be reviewed before launch in each target market.

---

# 16. Gate K — Candidate transparency and consent

Before interview:

- clearly disclose that the interviewer is AI;
- explain recording status;
- explain what data is processed;
- capture required consent;
- show privacy/retention information appropriate to deployment;
- provide support/escalation path;
- run device check.

During interview:

- visible recording/media state;
- understandable connection state;
- clear error/reconnect guidance;
- ability to request clarification;
- ability to end/leave under defined policy.

Consent records are versioned and auditable.

---

# 17. Gate L — Security

At minimum before real candidate data:

- tenant isolation tests;
- RBAC tests;
- encrypted transport;
- secure secrets management;
- private object storage;
- signed/short-lived media/file access where appropriate;
- PII-safe logging/redaction;
- dependency scanning;
- container hardening baseline;
- backup/restore validation;
- deletion/retention tests;
- audit integrity controls;
- rate limits/abuse controls;
- vulnerability review of candidate-facing upload/media paths.

Candidate code must never run in core application containers.

---

# 18. Gate M — Privacy and retention

Production requires explicit policy for:

```text
CV retention
audio retention
video retention
transcript retention
AI derived evidence retention
embedding/vector retention
candidate deletion requests
backup expiry
customer export
```

Deletion must cover derived data when required—not only the original uploaded CV/video.

All recording/analysis capabilities are subject to target jurisdiction and customer policy.

---

# 19. Gate N — Auditability

For a reviewed candidate we must be able to reconstruct:

```text
Job/rubric version
InterviewPlan version
Interviewer policy/prompt version
LLM model/provider
STT/TTS/avatar versions
questions asked
candidate answers
transcript/timestamps
evidence used
Evaluator version
criterion evaluations
ScoreEngine version
human overrides
final human action
```

Do not depend on hidden model reasoning. Store structured business-relevant rationale/evidence/provenance.

---

# 20. Gate O — Observability and operations

Required dashboards/alerts should include:

```text
interview starts/completions
abandonments
reconnects
STT failures
LLM failures
TTS failures
avatar failures
voice-only fallbacks
GPU utilization
media/TURN bandwidth
latency distributions
low-confidence sessions
review queue volume
AI/human disagreement metrics
```

Each interview has a correlation/session ID across API, worker and media logs.

Runbooks are required for severe realtime/service incidents before controlled production.

---

# 21. Gate P — Capacity and load

Before scaling:

Benchmark expected concurrency on actual target infrastructure.

Measure independently:

```text
LiveKit capacity
TURN bandwidth
STT CPU/GPU throughput
TTS throughput
avatar GPU throughput
LLM request concurrency
PostgreSQL writes
object-storage bandwidth
recording storage growth
```

Do not calculate concurrency from vendor marketing benchmarks alone.

Target concurrency remains an open project decision until benchmarked.

---

# 22. Gate Q — Unit economics

Architecture constraint:

```text
Mandatory usage-metered interview vendor
→ LLM API only, initially
```

Self-hosted media/speech/avatar still creates infrastructure cost.

Track per completed interview:

```text
LLM tokens/cost
GPU seconds
CPU seconds
TURN egress
media egress
recording storage
transcript/storage growth
average duration
retry/failure overhead
```

The commercial model must be based on real infrastructure cost, not the assumption that OSS means zero cost.

---

# 23. Gate R — Model and prompt versioning

Every production evaluation must identify the exact stack version.

Example:

```text
InterviewPlan        backend-senior-v4
Rubric               backend-senior-v7
InterviewerPolicy    v3
InterviewerPrompt    v11
LLM                  provider/model/version
STT                  whisper-model + quantization
TTS                  sara-fa-v3
Avatar               sara-avatar-v2 + renderer version
EvaluatorPrompt      v9
ScoreEngine          v5
```

Material changes trigger regression tests and may require recalibration.

---

# 24. Gate S — AI regression suite

Maintain fixed datasets for:

- interview planning;
- next-question selection;
- clarification;
- resume-claim probing;
- evidence extraction;
- contradiction identification;
- evaluator scoring;
- recommendation generation;
- policy/adversarial inputs.

CI or release pipelines should evaluate these fixtures before critical model/prompt changes reach production.

Model upgrades are product releases, not invisible backend swaps.

---

# 25. Gate T — Candidate UX

Pilot research must test whether candidates can:

- understand that interviewer is AI;
- understand recording/consent;
- complete device checks;
- hear/understand the interviewer;
- know when to speak;
- interrupt/clarify naturally;
- recover after connection problems;
- understand completion/next steps.

Track:

```text
completion rate
candidate abandonment
support requests
repeated question incidents
reconnect incidents
post-interview feedback
accessibility problems
```

The avatar is optional to production quality; a reliable respectful voice-only fallback is mandatory.

---

# 26. Human review policy

Production must define which sessions are automatically routed to review.

At minimum consider:

```text
low STT confidence
insufficient rubric coverage
low evaluator confidence
major resume/interview contradiction
technical service degradation
candidate complaint
unusual session length
failed/repeated questions
score near decision threshold
new/unvalidated job family
new model/prompt version sampling
```

Human review UI should expose source evidence rather than only the AI summary.

---

# 27. ProductionApproval record

Production approval should be stored as an auditable release artifact.

Conceptual fields:

```text
id
job_family
language
interview_type
rubric_family
interviewer_policy_version
speech_stack_version
avatar_stack_version
evaluator_version
status
approved_by
approved_at
validation_dataset_version
calibration_report_reference
security_review_reference
known_limitations
rollback_conditions
expires_or_review_at
```

Production eligibility must be machine-checkable, not tribal knowledge.

---

# 28. Suggested release checklist

## Product / Interview

- [ ] Rubric approved by domain owner.
- [ ] InterviewPlan coverage validated.
- [ ] Allowed/forbidden question policy defined.
- [ ] Adaptive follow-up tests pass.
- [ ] Candidate clarification/skip/end behavior passes.

## Speech / Realtime

- [ ] Persian STT benchmark completed.
- [ ] Persian-English code-switch benchmark completed.
- [ ] TTS quality accepted.
- [ ] Avatar quality accepted or intentionally disabled.
- [ ] Latency benchmark accepted.
- [ ] Reconnect/resume passes.
- [ ] Voice-only fallback passes.

## Evaluation

- [ ] Evidence accuracy sampled and accepted.
- [ ] Human calibration dataset completed.
- [ ] Criterion agreement accepted.
- [ ] False rejection analysis accepted.
- [ ] False promotion analysis accepted.
- [ ] Low-confidence routing works.

## Security / Privacy

- [ ] Tenant isolation tested.
- [ ] RBAC tested.
- [ ] Object/media access tested.
- [ ] Consent flow approved.
- [ ] Retention/deletion tested.
- [ ] Sensitive logs reviewed.
- [ ] Backup/restore checked.
- [ ] Target-market compliance review completed.

## Operations

- [ ] Monitoring dashboards exist.
- [ ] Alerts exist.
- [ ] Runbooks exist.
- [ ] Load test completed.
- [ ] Capacity plan approved.
- [ ] Cost model measured.
- [ ] Rollback/suspend switch tested.

Only after all applicable mandatory items pass may a release unit enter `CONTROLLED_PRODUCTION`.

---

# 29. Pilot success report

Each pilot should produce a report containing:

```text
release unit
number of interviews
completion rate
candidate feedback
human review rate
AI/human score agreement
critical disagreements
false rejection/promotion analysis
STT quality
latency distribution
reconnect/failure statistics
avatar/TTS failures
security/privacy incidents
unit cost
known limitations
recommended release state
```

The report should distinguish measured results from assumptions.

---

# 30. Suspension triggers

An autonomous interview mode should be suspendable if there is evidence of:

- serious privacy/security incident;
- cross-candidate/tenant evidence contamination;
- repeated material scoring defects;
- unacceptable false rejection behavior;
- interviewer policy violation;
- widespread corrupted transcripts;
- critical realtime failure rate;
- unreviewed major model/prompt change;
- expired/revoked actor/media rights;
- applicable regulatory/customer policy conflict.

Suspension does not need to disable the entire platform; affected release units can fall back to human interviews or supervised review.

---

# 31. What “production-ready” means for this project

Production-ready does not mean:

```text
Avatar talks
LLM asks questions
Demo looks impressive
```

It means:

```text
100 real candidates
→ consistent job-relevant interviews
→ recoverable realtime sessions
→ searchable transcripts
→ evidence-backed scorecards
→ calibrated evaluation
→ uncertain/degraded cases flagged
→ managers review defensible evidence
→ audit/privacy/security controls preserved
```

The production goal is to safely remove large amounts of repetitive recruiter/interviewer work—not to remove accountable human decision-making.

---

# 32. Current readiness

As of 2026-08-31:

```text
Architecture                    ✅ Defined
Self-hosted interview design    ✅ Defined
Production gates                ✅ Defined
Implementation                  ⬜ Not started
Calibration                     ⬜ Not started
Shadow testing                  ⬜ Not started
Pilot                           ⬜ Not started
Production approval             ⬜ Not approved
```

The next legitimate step is implementation and measurement, not declaring the product production-ready.
