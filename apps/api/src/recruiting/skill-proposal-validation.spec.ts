import assert from "node:assert/strict";
import test from "node:test";
import { exactReviewedAlias, validateSkillProposals } from "./skill-proposal-validation";

const resume = "Skills\nRedis, SQL Server, C#\nمتن رزومه";
const s = resume.indexOf("Redis");
const candidate = { skillKey: "redis", excerpt: "Redis", startChar: s, endChar: s + 5, confidence: 0.72 };

test("strict LLM proposal contract accepts only literal evidence with tenant-listed skills", () => {
  const data = { schemaVersion: "skill-proposals.v1", proposals: [
    candidate, candidate, { ...candidate, skillKey: "unknown-skill" },
    { ...candidate, endChar: s + 6 },
    { ...candidate, startChar: 999, endChar: 1004 },
  ] };
  assert.deepEqual(validateSkillProposals(data, resume, ["redis", "sql-server"]), [candidate]);
});

test("rejects malformed, overlong or instruction-like provider output, nonfinite confidence", () => {
  for (const payload of [
    { schemaVersion: "wrong", proposals: [] },
    { schemaVersion: "skill-proposals.v1", proposals: [{ ...candidate, confidence: 1.5 }] },
    { schemaVersion: "skill-proposals.v1", proposals: [{ ...candidate, injected: true }] },
    { schemaVersion: "skill-proposals.v1", proposals: [{ ...candidate, confidence: NaN }] },
    { schemaVersion: "skill-proposals.v1", proposals: Array.from({ length: 13 }, () => candidate) },
  ]) assert.throws(() => validateSkillProposals(payload, resume, ["redis"]));
});

test("reviewed alias must have exact source occurrence", () => {
  assert.equal(exactReviewedAlias(" Redis ", "Developed Redis caching"), "redis");
  assert.throws(() => exactReviewedAlias("Kubernetes", "Redis"));
  assert.throws(() => exactReviewedAlias("<script>", "<script>"));
});
