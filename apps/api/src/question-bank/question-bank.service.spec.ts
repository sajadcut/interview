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
