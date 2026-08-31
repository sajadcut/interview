import assert from "node:assert/strict";
import test from "node:test";
import { decideInterviewTurn, type InterviewBrainInput } from "./interview-brain";

function baseInput(): InterviewBrainInput {
  return {
    criteria: [
      {
        key: "backend_depth",
        label: "Backend engineering",
        objective: "validate production backend depth",
        expectedEvidence: ["production incident", "technical decision", "measurable outcome"],
        minimumEvidence: 1,
      },
      {
        key: "system_design",
        label: "System design",
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

test("brain starts with the first uncovered criterion and evidence-seeking turn", () => {
  const decision = decideInterviewTurn(baseInput());
  assert.equal(decision.turn.action, "ask");
  assert.equal(decision.turn.criterion, "backend_depth");
  assert.ok(decision.turn.expectedEvidence.length > 0);
  assert.equal(decision.nextState.currentCriterion, "backend_depth");
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
