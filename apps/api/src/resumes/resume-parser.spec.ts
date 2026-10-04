import assert from "node:assert/strict";
import test from "node:test";
import { ResumeParser } from "./resume-parser";

test("resume parser keeps role/company separate from location/date metadata", () => {
  const parser = new ResumeParser();
  const profile = parser.parse(`
Arman Rahimi
Senior .NET Developer | Backend & Distributed Systems
Email: arman.rahimi.test@example.com
Location: Tehran, Iran

CORE SKILLS
C#, ASP.NET Core, .NET 8, Entity Framework Core, SQL Server, PostgreSQL, Redis, RabbitMQ, Docker, Kubernetes

PROFESSIONAL EXPERIENCE
Senior .NET Developer / Tech Lead - NovaPay Systems
Tehran, Iran | Jan 2022 - Present
• Designed and delivered ASP.NET Core 8 microservices.
• Built REST APIs using C#, EF Core, SQL Server and PostgreSQL.

Senior Backend Developer - Faradid Software
Tehran, Iran | Mar 2019 - Dec 2021
• Developed enterprise ASP.NET Core Web APIs.
`);

  assert.equal(profile.currentRole, "Senior .NET Developer / Tech Lead");
  assert.equal(profile.currentCompany, "NovaPay Systems");
  assert.equal(profile.location, "Tehran, Iran");
  assert.equal(profile.experiences.length, 2);
  assert.equal(profile.experiences[0]?.startedOn, "2022-01-01");
  assert.equal(profile.experiences[0]?.endedOn, null);
  assert.equal(profile.experiences[1]?.title, "Senior Backend Developer");
  assert.equal(profile.experiences[1]?.company, "Faradid Software");

  const skillLabels = new Set(profile.skills.map((skill) => skill.label));
  for (const expected of [
    "C#",
    "ASP.NET Core",
    ".NET",
    "Entity Framework Core",
    "SQL Server",
    "SQL",
    "PostgreSQL",
    "Redis",
    "RabbitMQ",
    "Docker",
    "Kubernetes",
  ]) {
    assert.equal(skillLabels.has(expected), true, `missing skill ${expected}`);
  }
});


test("resume parser infers current location from experience metadata when no labeled location exists", () => {
  const parser = new ResumeParser();
  const profile = parser.parse(`
Arman Rahimi
Senior .NET Developer | Backend & Distributed Systems
Email: arman.rahimi.test@example.com

PROFESSIONAL EXPERIENCE
Senior .NET Developer / Tech Lead - NovaPay Systems
Tehran, Iran | Jan 2022 - Present
• Designed and delivered ASP.NET Core 8 microservices.

Senior Backend Developer - Faradid Software
Tehran, Iran | Mar 2019 - Dec 2021
• Developed enterprise ASP.NET Core Web APIs.
`);

  assert.equal(profile.location, "Tehran, Iran");
  assert.equal(profile.currentRole, "Senior .NET Developer / Tech Lead");
  assert.equal(profile.currentCompany, "NovaPay Systems");
  assert.equal(profile.parserVersion, "resume-structure-v3");
});
