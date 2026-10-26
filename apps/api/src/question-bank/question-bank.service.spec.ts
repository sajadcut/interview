import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseService } from "../database/database.service";
import type { TenantContextService } from "../tenant/tenant-context.service";
import type { StorageService } from "../storage/storage.service";
import type { ResumeTextExtractor } from "../resumes/resume-text-extractor";
import { QuestionBankService } from "./question-bank.service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const appId = "33333333-3333-4333-8333-333333333333";
const foreignDoc = "44444444-4444-4444-8444-444444444444";

test("cannot attach a question document belonging to another job", async () => {
  let deleted = false;
  const tx = async (strings: TemplateStringsArray) => {
    const query = strings.join(" ");
    if (query.includes("FROM applications") && query.includes("FOR UPDATE")) return [{ job_id: jobId }];
    if (query.includes("FROM interview_sessions")) return [];
    if (query.includes("FROM question_bank_documents")) return [];
    if (query.includes("DELETE FROM application_question_documents")) deleted = true;
    return [];
  };
  const sql = Object.assign(async () => [], {
    begin: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
  });
  const db = { sql } as unknown as DatabaseService;
  const tenant = { require: () => ({ organizationId }) } as TenantContextService;
  const service = new QuestionBankService(db, tenant, {} as StorageService, {} as ResumeTextExtractor);
  await assert.rejects(service.saveSelection(appId, [foreignDoc]), /does not belong/);
  assert.equal(deleted, false, "a rejected selection must not delete earlier choices");
});

test("cannot edit selection after an interview session exists", async () => {
  let writes = 0;
  const tx = async (strings: TemplateStringsArray) => {
    const query = strings.join(" ");
    if (query.includes("FROM applications") && query.includes("FOR UPDATE")) return [{ job_id: jobId }];
    if (query.includes("FROM interview_sessions")) return [{ id: "session-already-started" }];
    if (/DELETE|INSERT/.test(query)) writes += 1;
    return [];
  };
  const sql = Object.assign(async () => [], {
    begin: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
  });
  const db = { sql } as unknown as DatabaseService;
  const tenant = { require: () => ({ organizationId }) } as TenantContextService;
  const service = new QuestionBankService(db, tenant, {} as StorageService, {} as ResumeTextExtractor);
  await assert.rejects(service.saveSelection(appId, []), /locked after interview starts/);
  assert.equal(writes, 0);
});

test("valid UTF-8 document is extracted and persisted through private storage", async () => {
  const fileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let stored = 0;
  let inserted = 0;
  const sql = Object.assign(async (strings: TemplateStringsArray) => {
    const query = strings.join(" ");
    if (query.includes("SELECT id FROM jobs")) return [{ id: jobId }];
    if (query.includes("count(*)::int")) return [{ count: 0 }];
    if (query.includes("INSERT INTO question_bank_documents")) {
      inserted += 1;
      return [{
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        job_id: jobId,
        original_name: "questions.txt",
        mime_type: "text/plain",
        byte_size: 124,
        sha256: "c".repeat(64),
        extracted_text: "How would you design an idempotent .NET endpoint? ",
        created_at: new Date().toISOString(),
      }];
    }
    throw new Error("Unexpected SQL in question bank upload unit test");
  }, { json: (value: unknown) => value });
  const storage = {
    save: async (value: { data: Uint8Array; mimeType: string }) => {
      stored += 1;
      assert.equal(value.mimeType, "text/plain");
      assert.ok(value.data.byteLength > 40);
      return { id: fileId, key: organizationId + "/" + fileId, sha256: "c".repeat(64) };
    },
    deleteById: async () => { throw new Error("Upload should not be rolled back"); },
  } as unknown as StorageService;
  const extractor = {
    extract: async () => ({
      text: "How would you design an idempotent .NET endpoint? ".repeat(3),
      pageCount: null,
      extractorVersion: "test",
    }),
  } as unknown as ResumeTextExtractor;
  const tenant = { require: () => ({ organizationId }) } as TenantContextService;
  const bank = new QuestionBankService({ sql } as unknown as DatabaseService, tenant, storage, extractor);
  const result = await bank.upload(jobId, {
    originalname: "questions.txt",
    mimetype: "text/plain",
    size: 124,
    buffer: Buffer.from("How would you design an idempotent .NET endpoint? ".repeat(3)),
  });
  assert.equal(result.fileName, "questions.txt");
  assert.equal(stored, 1);
  assert.equal(inserted, 1);
});

test("an unsupported or corrupt file never reaches disk storage", async () => {
  const tenant = { require: () => ({ organizationId }) } as TenantContextService;
  let saved = false;
  const sql = async () => [{ id: jobId }];
  const storage = { save: async () => { saved = true; } } as unknown as StorageService;
  const extractor = { extract: async () => { throw new Error("Invalid PDF header"); } } as unknown as ResumeTextExtractor;
  const bank = new QuestionBankService({ sql } as unknown as DatabaseService, tenant, storage, extractor);
  await assert.rejects(bank.upload(jobId, {
    originalname: "broken.pdf",
    mimetype: "application/pdf",
    size: 6,
    buffer: Buffer.from("broken"),
  }), /Invalid PDF header/);
  assert.equal(saved, false);
});
