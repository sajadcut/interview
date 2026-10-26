import assert from "node:assert/strict";
import test from "node:test";
import { anchorResumeSkillClaim } from "./resume-skill-mapping";

test("anchors each .NET claim in its original resume and never verifies it", () => {
  const text = "Skills\nC#, ASP.NET Core, SQL Server, Redis, Microservices\nExperience\nBuilt billing services.";
  for (const [key, canonical] of [
    ["c-sharp", "c-sharp"], ["aspnet-core", "aspnet-core"], ["sql-server", "sql-server"],
    ["redis", "redis"], ["microservices", "microservices"],
  ]) {
    const actual = anchorResumeSkillClaim(text, { key, label: key });
    assert.equal(actual?.skill.key, canonical);
    assert.equal(text.slice(actual!.startChar, actual!.endChar), actual?.claimText);
    assert.ok(actual?.claimText.length);
  }
});

test("does not promote SQL Server to generic SQL and does not promote ASP.NET Core to .NET", () => {
  const source = "Skills: SQL Server, ASP.NET Core";
  assert.equal(anchorResumeSkillClaim(source, { key: "sql", label: "SQL" }), null);
  assert.equal(anchorResumeSkillClaim(source, { key: "dotnet", label: ".NET" }), null);
  assert.equal(anchorResumeSkillClaim(source, { key: "sql-server", label: "SQL Server" })?.skill.key, "sql-server");
});

test("rejects unlisted or unsupported skill mappings instead of hallucinating a claim", () => {
  assert.equal(anchorResumeSkillClaim("Experienced with RabbitMQ", { key: "kafka", label: "Kafka" }), null);
  assert.equal(anchorResumeSkillClaim("Experienced with RabbitMQ", { key: "redis", label: "Redis" }), null);
  assert.equal(anchorResumeSkillClaim("Designed service architecture", { key: "microservices", label: "Microservices" }), null);
});

test("uses exact spans in bilingual resumes and a bounded excerpt", () => {
  const source = "توسعه نرم‌افزار\n" + "x".repeat(600) + " Redis " + "y".repeat(700);
  const claim = anchorResumeSkillClaim(source, { key: "redis", label: "Redis" });
  assert.equal(claim?.skill.key, "redis");
  assert.ok(claim && claim.claimText.includes("Redis"));
  assert.ok(claim && claim.claimText.length <= 365);
  assert.equal(source.slice(claim!.startChar, claim!.endChar), claim?.claimText);
});
