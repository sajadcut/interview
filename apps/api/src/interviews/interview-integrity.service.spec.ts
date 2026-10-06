import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseService } from "../database/database.service";
import type { TenantContextService } from "../tenant/tenant-context.service";
import type { AuthContextService } from "../auth/auth-context.service";
import type { AuditService } from "../audit/audit.service";
import { InterviewIntegrityService } from "./interview-integrity.service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const mediaSessionId = "33333333-3333-4333-8333-333333333333";

function harness(options: { sessionStatus?: string; sessionExists?: boolean } = {}) {
  let insertedValues: unknown[] = [];
  const sessionExists = options.sessionExists !== false;
  const status = options.sessionStatus ?? "in_progress";

  const transaction = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join(" ");
      if (query.includes("FROM interview_media_sessions")) return [{ id: mediaSessionId }];
      if (query.includes("COALESCE(max(sequence)")) return [{ next_sequence: 0 }];
      if (query.includes("INSERT INTO interview_integrity_events")) {
        insertedValues = values;
        return [{ id: "44444444-4444-4444-8444-444444444444", server_occurred_at: new Date("2026-10-06T08:00:00.000Z") }];
      }
      throw new Error(`Unexpected integrity transaction SQL: ${query.replace(/\s+/g, " ").trim()}`);
    },
    { json: (value: unknown) => value },
  );

  const sql = Object.assign(
    async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("FROM interview_sessions")) {
        return sessionExists
          ? [{ id: sessionId, status, started_at: null, completed_at: status === "completed" ? new Date().toISOString() : null }]
          : [];
      }
      throw new Error(`Unexpected integrity SQL: ${query.replace(/\s+/g, " ").trim()}`);
    },
    {
      json: (value: unknown) => value,
      begin: async <T>(callback: (tx: typeof transaction) => Promise<T>) => callback(transaction),
    },
  );

  const database = { sql } as unknown as DatabaseService;
  const tenant = { require: () => ({ organizationId }) } as TenantContextService;
  const auth = { getOptional: () => ({ userId: "55555555-5555-4555-8555-555555555555", source: "session" as const }) } as AuthContextService;
  const audit = { record: async () => undefined } as unknown as AuditService;
  return {
    service: new InterviewIntegrityService(database, tenant, auth, audit),
    insertedValues: () => insertedValues,
  };
}

test("candidate cannot submit server-only concurrent-session signals", async () => {
  const { service } = harness();
  await assert.rejects(
    () => service.recordCandidateEvent(sessionId, mediaSessionId, {
      eventType: "concurrent_session_detected",
      severity: "high",
    }),
    /Unsupported candidate integrity event/,
  );
});

test("candidate-supplied severity is ignored and camera toggle stays informational", async () => {
  const { service, insertedValues } = harness();
  await service.recordCandidateEvent(sessionId, mediaSessionId, {
    eventType: "camera_disabled",
    severity: "high",
    metadata: { severity: "high", text: "must not persist" },
  });
  assert.ok(insertedValues().includes("informational"));
  assert.equal(insertedValues().includes("high"), false);
  const persistedMetadata = insertedValues().find(
    (value) => value && typeof value === "object" && !Array.isArray(value),
  ) as Record<string, unknown> | undefined;
  assert.deepEqual(persistedMetadata, {});
});

test("integrity analysis refuses to run before canonical Finish", async () => {
  const { service } = harness({ sessionStatus: "in_progress" });
  await assert.rejects(
    () => service.analyzeAndPersist(sessionId),
    /only after interview Finish/,
  );
});

test("tenant-scoped lookup fails closed when session is not in the active organization", async () => {
  const { service } = harness({ sessionExists: false });
  await assert.rejects(
    () => service.getAssessment(sessionId),
    /Interview session not found/,
  );
});

test("human review requires an explicit comment and cannot edit risk score", async () => {
  const { service } = harness({ sessionStatus: "completed" });
  await assert.rejects(
    () => service.review(sessionId, {
      status: "reviewed_concern",
      integrityConcernScore: 0,
      comment: "",
    }),
    /comment is required/,
  );
});
