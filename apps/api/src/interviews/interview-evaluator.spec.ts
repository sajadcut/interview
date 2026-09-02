import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERVIEW_EVALUATOR_DRAFT_SCHEMA,
  INTERVIEW_EVALUATOR_INPUT_SCHEMA,
  InterviewEvaluationValidationError,
  evaluateInterviewDraft,
  parseInterviewEvaluatorDraft,
  type InterviewEvaluatorInput,
} from "./interview-evaluator";

const criterionA = "11111111-1111-4111-8111-111111111111";
const criterionB = "22222222-2222-4222-8222-222222222222";
const segmentA = "33333333-3333-4333-8333-333333333333";
const segmentB = "44444444-4444-4444-8444-444444444444";
const evidenceA = "55555555-5555-4555-8555-555555555555";
const evidenceB = "66666666-6666-4666-8666-666666666666";

function input(): InterviewEvaluatorInput {
  return {
    schemaVersion: INTERVIEW_EVALUATOR_INPUT_SCHEMA,
    sessionId: "77777777-7777-4777-8777-777777777777",
    applicationId: "88888888-8888-4888-8888-888888888888",
    sessionStatus: "completed",
    rubricVersionId: "99999999-9999-4999-8999-999999999999",
    planVersion: 1,
    evaluatorVersion: "evidence-evaluator-v1",
    criteria: [
      {
        id: criterionA,
        criterionKey: "architecture",
        label: "Architecture",
        description: null,
        weight: 2,
        required: true,
        evidencePolicy: {},
        displayOrder: 0,
      },
      {
        id: criterionB,
        criterionKey: "debugging",
        label: "Debugging",
        description: null,
        weight: 1,
        required: true,
        evidencePolicy: {},
        displayOrder: 1,
      },
    ],
    transcript: [
      {
        id: segmentA,
        speaker: "candidate",
        startMs: 0,
        endMs: 1000,
        text: "I split the service around bounded contexts.",
        isFinal: true,
        sttConfidence: 0.95,
      },
      {
        id: segmentB,
        speaker: "candidate",
        startMs: 1100,
        endMs: 2000,
        text: "I reproduced the issue and narrowed the failing dependency.",
        isFinal: true,
        sttConfidence: 0.85,
      },
    ],
    evidence: [
      {
        id: evidenceA,
        criterionId: criterionA,
        turnId: null,
        transcriptSegmentIds: [segmentA],
        summary: "Concrete architecture example",
        confidence: 0.9,
      },
      {
        id: evidenceB,
        criterionId: criterionB,
        turnId: null,
        transcriptSegmentIds: [segmentB],
        summary: "Concrete debugging example",
        confidence: 0.8,
      },
    ],
    boundaries: {
      evidenceOnly: true,
      unsupportedInference: "insufficient_evidence",
      recommendationIsDecisionSupport: true,
      finalHiringAuthority: "human",
    },
  };
}

function draft(overrides: Record<string, unknown> = {}) {
  return parseInterviewEvaluatorDraft({
    schemaVersion: INTERVIEW_EVALUATOR_DRAFT_SCHEMA,
    idempotencyKey: "evaluation:test:1",
    evaluatorVersion: "evidence-evaluator-v1",
    criterionResults: [
      {
        criterionId: criterionA,
        score: 90,
        rationale: "The candidate supplied a concrete architecture tradeoff.",
        evidenceIds: [evidenceA],
        confidence: 0.92,
      },
      {
        criterionId: criterionB,
        score: 60,
        rationale: "The candidate described a repeatable debugging method.",
        evidenceIds: [evidenceB],
        confidence: 0.9,
      },
    ],
    providerRecommendation: "strong_recommend",
    provenance: {
      provider: "fixture-provider",
      model: "fixture-model",
      promptVersion: "evaluator-prompt-v1",
    },
    ...overrides,
  });
}

test("evaluator validates evidence and derives deterministic weighted recommendation", () => {
  const result = evaluateInterviewDraft(input(), draft());
  assert.equal(result.status, "validated");
  assert.equal(result.overallScore, 80);
  assert.equal(result.recommendation, "review");
  assert.equal(result.providerRecommendation, "strong_recommend");
  assert.equal(result.overallConfidence, 0.8667);
  assert.equal(result.evidenceComplete, true);
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.scoringAlgorithmVersion, "weighted-evidence-v1");
  assert.ok(result.reviewReasons.includes("human_final_authority"));
  assert.ok(result.reviewReasons.includes("provider_algorithm_disagreement"));
  assert.ok(
    result.validation.warnings.some((warning) => warning.code === "provider_recommendation_disagrees"),
  );
});

test("missing rubric result becomes insufficient evidence instead of inventing a score", () => {
  const partial = draft({
    providerRecommendation: "review",
    criterionResults: [
      {
        criterionId: criterionA,
        score: 90,
        rationale: "The candidate supplied a concrete architecture tradeoff.",
        evidenceIds: [evidenceA],
        confidence: 0.92,
      },
    ],
  });
  const result = evaluateInterviewDraft(input(), partial);
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.overallScore, null);
  assert.equal(result.recommendation, "insufficient_evidence");
  assert.deepEqual(result.validation.missingRequiredCriterionIds, [criterionB]);
  assert.equal(result.criterionResults[1]?.score, null);
  assert.equal(result.criterionResults[1]?.status, "insufficient_evidence");
});

test("cross-criterion evidence is rejected", () => {
  const invalid = draft({
    criterionResults: [
      {
        criterionId: criterionA,
        score: 90,
        rationale: "Wrongly referenced evidence.",
        evidenceIds: [evidenceB],
        confidence: 0.9,
      },
    ],
  });
  assert.throws(
    () => evaluateInterviewDraft(input(), invalid),
    (error: unknown) =>
      error instanceof InterviewEvaluationValidationError &&
      error.issues.some((issue) => issue.code === "cross_criterion_evidence"),
  );
});

test("scoring without candidate-authored transcript evidence is rejected", () => {
  const value = input();
  value.transcript[0] = { ...value.transcript[0]!, speaker: "interviewer" };
  const onlyArchitecture = draft({
    criterionResults: [
      {
        criterionId: criterionA,
        score: 80,
        rationale: "This must not be accepted without candidate evidence.",
        evidenceIds: [evidenceA],
      },
    ],
  });
  assert.throws(
    () => evaluateInterviewDraft(value, onlyArchitecture),
    (error: unknown) =>
      error instanceof InterviewEvaluationValidationError &&
      error.issues.some((issue) => issue.code === "no_candidate_evidence"),
  );
});

test("low confidence is escalated even when evidence coverage is complete", () => {
  const value = input();
  value.evidence[0] = { ...value.evidence[0]!, confidence: 0.4 };
  const result = evaluateInterviewDraft(value, draft({ providerRecommendation: "review" }));
  assert.equal(result.status, "low_confidence");
  assert.ok(result.reviewReasons.includes("low_confidence"));
  assert.ok(result.validation.warnings.some((warning) => warning.code === "low_criterion_confidence"));
});

test("draft parser requires versioned provenance and idempotency", () => {
  assert.throws(
    () =>
      parseInterviewEvaluatorDraft({
        schemaVersion: INTERVIEW_EVALUATOR_DRAFT_SCHEMA,
        evaluatorVersion: "evidence-evaluator-v1",
        criterionResults: [],
        provenance: { provider: "fixture-provider", promptVersion: "v1" },
      }),
    InterviewEvaluationValidationError,
  );
});
