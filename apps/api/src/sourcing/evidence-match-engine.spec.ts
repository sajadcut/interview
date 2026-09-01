import assert from "node:assert/strict";
import test from "node:test";
import { calculateEvidenceConceptMatch } from "./evidence-match-engine";

test("evidence concept matching normalizes common technical aliases and cites evidence", () => {
  const result = calculateEvidenceConceptMatch({
    requirements: [
      { id: "r1", name: "PostgreSQL", weight: 1, requirementType: "must_have" },
      { id: "r2", name: "Kubernetes", weight: 1, requirementType: "must_have" },
    ],
    skills: [
      { label: "Postgres", verificationState: "verified", sourceReference: "resume:skills" },
      { label: "k8s", sourceReference: "interview:12:10" },
    ],
    experiences: [],
  });

  assert.equal(result.score, 100);
  assert.deepEqual(result.missingMustHaveRequirementIds, []);
  assert.equal(result.components.every((component) => component.evidenceBacked), true);
});

test("unverified inferred skill without evidence does not satisfy a must-have", () => {
  const result = calculateEvidenceConceptMatch({
    requirements: [{ id: "r1", name: "Kafka", weight: 1, requirementType: "must_have" }],
    skills: [{ label: "Kafka", verificationState: "unverified" }],
    experiences: [],
  });

  assert.equal(result.score, 0);
  assert.deepEqual(result.missingMustHaveRequirementIds, ["r1"]);
});

test("matching result is explicitly a pre-interview signal", () => {
  const result = calculateEvidenceConceptMatch({ requirements: [], skills: [], experiences: [] });
  assert.match(result.notice, /not a hiring score/i);
});
