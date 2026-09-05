import assert from "node:assert/strict";
import test from "node:test";
import { evaluateInterviewRelease } from "./interview-release.policy";

const validProduction = {
  lifecycleStage: "CONTROLLED_PRODUCTION" as const,
  candidateIsRealCustomerCandidate: true,
  synchronousHumanSupervisorPresent: false,
  approvalStatus: "approved",
  approvedAt: "2026-01-01T00:00:00.000Z",
  approvedByUserId: "11111111-1111-4111-8111-111111111111",
  approvalExpiresAt: "2027-01-01T00:00:00.000Z",
  materialFingerprint: "a".repeat(64),
  approvedMaterialFingerprint: "a".repeat(64),
  approvalArtifactComplete: true,
  now: new Date("2026-09-05T00:00:00.000Z"),
};

test("development and shadow stages block real candidates", () => {
  for (const lifecycleStage of ["DEV_ONLY", "INTERNAL_TEST", "SHADOW"] as const) {
    assert.equal(evaluateInterviewRelease({ ...validProduction, lifecycleStage }).allowed, false);
  }
});

test("supervised pilot requires active human ownership", () => {
  assert.equal(evaluateInterviewRelease({ ...validProduction, lifecycleStage: "SUPERVISED_PILOT", synchronousHumanSupervisorPresent: false }).allowed, false);
  assert.equal(evaluateInterviewRelease({ ...validProduction, lifecycleStage: "SUPERVISED_PILOT", synchronousHumanSupervisorPresent: true }).allowed, true);
});

test("legacy production timestamp alone is not a production release artifact", () => {
  const decision = evaluateInterviewRelease({
    lifecycleStage: "CONTROLLED_PRODUCTION",
    candidateIsRealCustomerCandidate: true,
    synchronousHumanSupervisorPresent: false,
    productionApprovedAt: "2026-01-01T00:00:00.000Z",
    productionApprovedByUserId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(decision.allowed, false);
});

test("valid, complete, unexpired approval artifact allows controlled production", () => {
  assert.equal(evaluateInterviewRelease(validProduction).allowed, true);
});

test("expired approval fails closed", () => {
  assert.equal(evaluateInterviewRelease({ ...validProduction, approvalExpiresAt: "2026-01-02T00:00:00.000Z" }).allowed, false);
});

test("material fingerprint mismatch requires revalidation", () => {
  assert.equal(evaluateInterviewRelease({ ...validProduction, materialFingerprint: "b".repeat(64) }).allowed, false);
});

test("suspended release always fails closed", () => {
  assert.equal(evaluateInterviewRelease({ ...validProduction, lifecycleStage: "SUSPENDED" }).allowed, false);
});
