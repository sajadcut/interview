import assert from "node:assert/strict";
import test from "node:test";
import { validateStructuredInterviewTurn } from "./interview-contracts";
import { evaluateInterviewRelease } from "./interview-release.policy";

test("evidence-seeking interview turns require explicit evidence objectives", () => {
  assert.throws(
    () =>
      validateStructuredInterviewTurn({
        action: "probe",
        criterion: "kubernetes",
        objective: "production_debugging",
        spokenText: "Describe a production incident you debugged.",
        expectedEvidence: [],
      }),
    /expectedEvidence/,
  );
});

test("real candidates cannot run autonomously in DEV_ONLY", () => {
  const decision = evaluateInterviewRelease({
    lifecycleStage: "DEV_ONLY",
    productionApprovedAt: null,
    productionApprovedByUserId: null,
    candidateIsRealCustomerCandidate: true,
    synchronousHumanSupervisorPresent: false,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.mode, "blocked");
});

test("controlled production requires an explicit production approval record", () => {
  const decision = evaluateInterviewRelease({
    lifecycleStage: "CONTROLLED_PRODUCTION",
    productionApprovedAt: null,
    productionApprovedByUserId: null,
    candidateIsRealCustomerCandidate: true,
    synchronousHumanSupervisorPresent: false,
  });

  assert.equal(decision.allowed, false);
});

test("production approval permits interview autonomy but not final hiring authority", () => {
  const approverId = "11111111-1111-4111-8111-111111111111";
  const materialFingerprint = "release-material-v2-fixture";
  const decision = evaluateInterviewRelease({
    lifecycleStage: "CONTROLLED_PRODUCTION",
    productionApprovedAt: "2026-08-31T00:00:00Z",
    productionApprovedByUserId: approverId,
    candidateIsRealCustomerCandidate: true,
    synchronousHumanSupervisorPresent: false,
    approvalStatus: "approved",
    approvedAt: "2026-08-31T00:00:00Z",
    approvedByUserId: approverId,
    approvalExpiresAt: "2026-12-31T00:00:00Z",
    materialFingerprint,
    approvedMaterialFingerprint: materialFingerprint,
    approvalArtifactComplete: true,
    now: new Date("2026-09-05T00:00:00Z"),
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.mode, "autonomous");
  assert.match(decision.reasons[0] ?? "", /final employment decisions stay human-controlled/);
});
