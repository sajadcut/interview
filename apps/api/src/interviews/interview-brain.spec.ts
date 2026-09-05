import assert from "node:assert/strict";
import test from "node:test";
import { decideInterviewTurn, type InterviewBrainInput } from "./interview-brain";
import { containsPersianScript } from "./interview-language";

function baseInput(): InterviewBrainInput {
  return {
    criteria: [
      {
        key: "backend_depth",
        label: "Backend engineering",
        spokenLabel: "مهندسی بک‌اند",
        objective: "validate production backend depth",
        expectedEvidence: ["production incident", "technical decision", "measurable outcome"],
        minimumEvidence: 1,
      },
      {
        key: "system_design",
        label: "System design",
        spokenLabel: "طراحی سیستم",
        objective: "validate scalable system-design reasoning",
        expectedEvidence: ["requirements", "trade-offs", "failure modes"],
        minimumEvidence: 1,
      },
    ],
    state: {
      currentCriterion: null,
      askedQuestionIds: [],
      evidenceCoverage: {},
      remainingSeconds: 2700,
      reconnectCount: 0,
    },
    latestCandidateText: "",
    candidateIntent: null,
    elapsedSeconds: 0,
  };
}

function persianInput(): InterviewBrainInput {
  return { ...baseInput(), language: "fa" };
}

function assertPersianSpeech(input: InterviewBrainInput) {
  const decision = decideInterviewTurn(input);
  assert.equal(containsPersianScript(decision.turn.spokenText), true);
  assert.doesNotMatch(decision.turn.spokenText, /Backend engineering|System design|production incident/i);
  return decision;
}

test("brain starts with the first uncovered criterion and evidence-seeking turn", () => {
  const decision = decideInterviewTurn(baseInput());
  assert.equal(decision.turn.action, "ask");
  assert.equal(decision.turn.criterion, "backend_depth");
  assert.ok(decision.turn.expectedEvidence.length > 0);
  assert.equal(decision.nextState.currentCriterion, "backend_depth");
  assert.match(decision.turn.spokenText, /Backend engineering/);
});

test("brain moves to the next criterion once evidence minimum is covered", () => {
  const input = baseInput();
  input.state.currentCriterion = "backend_depth";
  input.state.evidenceCoverage.backend_depth = 1;
  input.state.askedQuestionIds = ["backend_depth:ask:1"];
  input.latestCandidateText = "I diagnosed queue backpressure and changed retry behavior.";
  input.candidateIntent = "ANSWER";

  const decision = decideInterviewTurn(input);
  assert.equal(decision.turn.action, "ask");
  assert.equal(decision.turn.criterion, "system_design");
});

test("brain respects skip requests without inventing evidence coverage", () => {
  const input = baseInput();
  input.state.currentCriterion = "backend_depth";
  input.candidateIntent = "SKIP_REQUEST";

  const decision = decideInterviewTurn(input);
  assert.equal(decision.turn.action, "transition");
  assert.equal(decision.turn.criterion, "system_design");
  assert.equal(decision.nextState.evidenceCoverage.backend_depth, undefined);
});

test("brain treats reconnect as recovery instead of evidence", () => {
  const input = baseInput();
  input.state.currentCriterion = "backend_depth";
  input.state.reconnectCount = 2;
  input.candidateIntent = "RECONNECT";

  const decision = decideInterviewTurn(input);
  assert.equal(decision.turn.action, "clarify");
  assert.equal(decision.nextState.reconnectCount, 3);
  assert.deepEqual(decision.turn.expectedEvidence, []);
});

test("brain routes candidate factual questions away from improvisation", () => {
  const input = baseInput();
  input.state.currentCriterion = "backend_depth";
  input.candidateIntent = "CANDIDATE_QUESTION";

  const decision = decideInterviewTurn(input);
  assert.equal(decision.turn.action, "escalate");
  assert.match(decision.reason, /approved knowledge/i);
});

test("brain closes when the configured evidence coverage is complete", () => {
  const input = baseInput();
  input.state.evidenceCoverage = { backend_depth: 1, system_design: 1 };

  const decision = decideInterviewTurn(input);
  assert.equal(decision.turn.action, "close");
  assert.equal(decision.turn.criterion, null);
});

test("brain closes when the time budget has reached the final minute", () => {
  const input = baseInput();
  input.state.remainingSeconds = 70;
  input.elapsedSeconds = 15;

  const decision = decideInterviewTurn(input);
  assert.equal(decision.turn.action, "close");
  assert.equal(decision.nextState.remainingSeconds, 55);
  assert.match(decision.reason, /time budget/i);
});

test("Persian brain uses Persian spoken labels and never speaks English rubric labels", () => {
  const decision = assertPersianSpeech(persianInput());
  assert.equal(decision.turn.action, "ask");
  assert.match(decision.turn.spokenText, /مهندسی بک‌اند/);
});

test("Persian brain falls back to a Persian ordinal when a rubric label has no Persian spoken label", () => {
  const input = persianInput();
  delete input.criteria[0]?.spokenLabel;
  const decision = assertPersianSpeech(input);
  assert.match(decision.turn.spokenText, /موضوع شماره 1/);
});

test("Persian operational intents always produce Persian speech", () => {
  const intents = [
    "RECONNECT",
    "CLARIFICATION_REQUEST",
    "INTERRUPTION",
    "SILENCE_TIMEOUT",
    "CANDIDATE_QUESTION",
    "SKIP_REQUEST",
    "POLICY_REFUSAL",
    "END_INTERVIEW_REQUEST",
    "ABUSIVE_INPUT",
  ] as const;

  for (const candidateIntent of intents) {
    const input = persianInput();
    input.state.currentCriterion = "backend_depth";
    input.candidateIntent = candidateIntent;
    assertPersianSpeech(input);
  }
});

test("Persian probe does not speak internal English expected-evidence text", () => {
  const input = persianInput();
  input.state.currentCriterion = "backend_depth";
  input.state.askedQuestionIds = ["backend_depth:ask:1"];
  input.latestCandidateText = "یک پاسخ اولیه";
  input.candidateIntent = "ANSWER";

  const decision = assertPersianSpeech(input);
  assert.equal(decision.turn.action, "probe");
  assert.doesNotMatch(decision.turn.spokenText, /technical decision|measurable outcome/i);
});

test("Persian close paths remain Persian", () => {
  const noCriteria = persianInput();
  noCriteria.criteria = [];
  assertPersianSpeech(noCriteria);

  const complete = persianInput();
  complete.state.evidenceCoverage = { backend_depth: 1, system_design: 1 };
  assertPersianSpeech(complete);

  const timedOut = persianInput();
  timedOut.state.remainingSeconds = 60;
  assertPersianSpeech(timedOut);
});
