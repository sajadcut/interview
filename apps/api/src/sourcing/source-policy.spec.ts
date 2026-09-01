import assert from "node:assert/strict";
import test from "node:test";
import {
  ApprovedSourceTypes,
  type CandidateSourceAdapter,
} from "./candidate-source.adapter";
import { evaluateSourcePolicy, SOURCE_POLICY_VERSION } from "./source-policy";

const internalAdapter: CandidateSourceAdapter = {
  sourceType: ApprovedSourceTypes.InternalTalentPool,
  providerKey: "internal-test",
  requiresApproval: false,
  search: async () => [],
};

const atsAdapter: CandidateSourceAdapter = {
  sourceType: ApprovedSourceTypes.Ats,
  providerKey: "ats-test",
  requiresApproval: true,
  search: async () => [],
};

test("internal sourcing is allowed without approval and bounded by policy", () => {
  const decision = evaluateSourcePolicy({
    sourceType: ApprovedSourceTypes.InternalTalentPool,
    requestedLimit: 500,
    adapter: internalAdapter,
  });
  assert.equal(decision.policyVersion, SOURCE_POLICY_VERSION);
  assert.equal(decision.limit, 100);
  assert.equal(decision.requiresApproval, false);
});

test("external sourcing fails closed without explicit human approval", () => {
  assert.throws(
    () =>
      evaluateSourcePolicy({
        sourceType: ApprovedSourceTypes.Ats,
        requestedLimit: 25,
        adapter: atsAdapter,
      }),
    /requires explicit human approval/i,
  );
});

test("approval-gated sourcing records the approving user", () => {
  const decision = evaluateSourcePolicy({
    sourceType: ApprovedSourceTypes.Ats,
    requestedLimit: 25,
    adapter: atsAdapter,
    approvalConfirmed: true,
    approverUserId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(decision.requiresApproval, true);
  assert.equal(decision.approvedByUserId, "11111111-1111-4111-8111-111111111111");
});
