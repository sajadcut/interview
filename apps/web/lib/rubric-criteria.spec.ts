import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInterviewCoverage,
  coverageSummary,
  isSoftSkillCriterion,
} from "./rubric-criteria";

test("Senior .NET coverage exposes required optional and missing areas", () => {
  const areas = buildInterviewCoverage({
    title: "Senior .NET Developer",
    seniority: "Senior",
    summary: "Backend services with ASP.NET Core, SQL and Redis",
    requirements: [
      { name: "C# / .NET", requirementType: "must_have" },
      { name: "ASP.NET Core Web API", requirementType: "must_have" },
      { name: "Redis", requirementType: "nice_to_have" },
    ],
    criteria: [
      { criterionKey: "dotnet_fundamentals", label: "مبانی C# / .NET", required: true },
      { criterionKey: "aspnet_core", label: "ASP.NET Core / Web API", required: true },
      { criterionKey: "caching", label: "Caching / Redis", required: false },
      { criterionKey: "communication", label: "وضوح و ساختار ارتباط", required: true },
    ],
  });

  assert.equal(areas.find((area) => area.key === "dotnet_fundamentals")?.status, "required");
  assert.equal(areas.find((area) => area.key === "caching")?.status, "optional");
  assert.equal(areas.find((area) => area.key === "system_design")?.status, "missing");
  assert.ok(areas.some((area) => area.key === "security"));
  assert.ok(areas.some((area) => area.key === "observability"));
  assert.ok(coverageSummary(areas).missing > 0);
});

test("decision, ambiguity, stakeholder and trade-off criteria stay transcript-only soft skills", () => {
  for (const label of [
    "حل مسئله و مدیریت ابهام",
    "ارتباط با ذی‌نفعان",
    "تصمیم‌گیری",
    "استدلال درباره بده‌بستان‌ها",
  ]) {
    assert.equal(isSoftSkillCriterion({ label }), true, label);
  }
});
