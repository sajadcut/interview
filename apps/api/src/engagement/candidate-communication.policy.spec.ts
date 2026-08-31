import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCandidateReplyPolicy, evaluateHardMinimums } from "./candidate-communication.policy";

test("candidate reply policy blocks ungrounded factual replies", () => {
  const result = evaluateCandidateReplyPolicy({
    body: "The role is fully remote.",
    groundingReferences: [],
    autoSendRequested: true,
    autoSendPolicyEnabled: true,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.approvalState, "blocked");
});

test("candidate reply policy requires human approval unless auto-send is explicitly enabled", () => {
  const result = evaluateCandidateReplyPolicy({
    body: "The approved salary range is available in the job information.",
    groundingReferences: ["knowledge:item:salary-range-v2"],
    autoSendRequested: false,
    autoSendPolicyEnabled: false,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.approvalState, "requires_human_approval");
});

test("hard minimum evaluation remains deterministic and always routes to review", () => {
  const result = evaluateHardMinimums(
    [
      { key: "work_authorization", required: true, expected: true },
      { key: "minimum_years", required: true, expected: 5 },
    ],
    { work_authorization: true, minimum_years: 4 },
  );

  assert.equal(result.eligible, false);
  assert.deepEqual(result.failedRequiredRules, ["minimum_years"]);
  assert.equal(result.reviewRequired, true);
});
