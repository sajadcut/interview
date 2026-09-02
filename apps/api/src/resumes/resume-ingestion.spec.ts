import assert from "node:assert/strict";
import test from "node:test";
import { ResumeChunker } from "./resume-chunker";
import { ResumeParser } from "./resume-parser";
import { ResumeTextExtractor } from "./resume-text-extractor";

test("plain-text resume extraction, parsing and chunking preserve evidence provenance inputs", async () => {
  const extractor = new ResumeTextExtractor();
  const parser = new ResumeParser();
  const chunker = new ResumeChunker();
  const source = `Sara Ahmadi\nEmail: sara@example.com\nLocation: Tehran\n\nSkills\nTypeScript, Node.js, PostgreSQL, Docker\n\nWork Experience\nSenior Backend Engineer — Example Co | 2022 - Present\nBuilt Node.js APIs with PostgreSQL and Docker for production workloads.\n\nEducation\nBSc Computer Engineering`;

  const extracted = await extractor.extract({
    data: Buffer.from(source, "utf8"),
    mimeType: "text/plain",
    originalName: "resume.txt",
  });
  const profile = parser.parse(extracted.text);
  const chunks = chunker.chunk(extracted.text, 120, 20);

  assert.equal(profile.email, "sara@example.com");
  assert.equal(profile.location, "Tehran");
  assert.equal(profile.currentRole, "Senior Backend Engineer");
  assert.equal(profile.currentCompany, "Example Co");
  assert.equal(profile.skills.some((skill) => skill.key === "typescript"), true);
  assert.equal(profile.skills.some((skill) => skill.key === "node-js"), true);
  assert.equal(profile.experiences.length, 1);
  assert.equal(profile.experiences[0]?.startedOn, "2022-01-01");
  assert.equal(profile.experiences[0]?.endedOn, null);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks.every((chunk) => /^[0-9a-f]{64}$/.test(chunk.contentHash)), true);
});

test("resume extractor rejects binary text and unsupported media instead of inventing content", async () => {
  const extractor = new ResumeTextExtractor();
  await assert.rejects(
    () => extractor.extract({ data: Uint8Array.from([65, 0, 66, 67]), mimeType: "text/plain", originalName: "bad.txt" }),
    /invalid binary data/,
  );
  await assert.rejects(
    () => extractor.extract({ data: Buffer.from("not a resume"), mimeType: "image/png", originalName: "resume.png" }),
    /Supported resume formats/,
  );
});

test("persian resume language and skill section are parsed deterministically", () => {
  const parser = new ResumeParser();
  const text = `علی رضایی\nمحل سکونت: تهران\n\nمهارت‌ها\nTypeScript، PostgreSQL، Docker\n\nسوابق کاری\nBackend Engineer — شرکت نمونه | 2021 - اکنون\nتوسعه سرویس‌های بک‌اند`;
  const profile = parser.parse(text);
  assert.equal(profile.preferredLanguage, "fa");
  assert.equal(profile.location, "تهران");
  assert.equal(profile.skills.some((skill) => skill.key === "postgresql"), true);
  assert.equal(profile.experiences.length, 1);
});
