import assert from "node:assert/strict";
import test from "node:test";
import { calculateEvidenceBackedScore } from "./score-engine";

test("score engine refuses a consequential score when evidence is missing", () => {
  const result = calculateEvidenceBackedScore([
    { criterionId: "system-design", weight: 2, score: 90, evidenceIds: ["e1"] },
    { criterionId: "debugging", weight: 1, score: 80, evidenceIds: [] },
  ]);

  assert.equal(result.status, "incomplete");
  assert.equal(result.overallScore, null);
  assert.deepEqual(result.missingEvidenceCriterionIds, ["debugging"]);
});

test("score engine calculates the final score deterministically from rubric weights", () => {
  const result = calculateEvidenceBackedScore([
    { criterionId: "system-design", weight: 2, score: 90, evidenceIds: ["e1"] },
    { criterionId: "debugging", weight: 1, score: 75, evidenceIds: ["e2", "e3"] },
  ]);

  assert.equal(result.status, "complete");
  assert.equal(result.overallScore, 85);
  assert.equal(result.recommendation, "strong_recommend");
  assert.equal(result.algorithmVersion, "weighted-evidence-v1");
});
