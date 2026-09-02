import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./foundation";

export const aiExecutions = pgTable(
  "ai_executions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    capability: varchar("capability", { length: 120 }).notNull(),
    provider: varchar("provider", { length: 80 }).notNull(),
    model: varchar("model", { length: 160 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 120 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    inputReferences: jsonb("input_references"),
    structuredOutput: jsonb("structured_output"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    latencyMs: integer("latency_ms"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("ai_executions_org_created_idx").on(table.organizationId, table.createdAt),
    index("ai_executions_capability_idx").on(table.organizationId, table.capability),
    uniqueIndex("ai_executions_org_id_uidx").on(table.organizationId, table.id),
  ],
);

export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    executionId: uuid("execution_id").references(() => aiExecutions.id, { onDelete: "set null" }),
    capability: varchar("capability", { length: 120 }).notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: varchar("status", { length: 32 }).notNull().default("queued"),
    priority: integer("priority").notNull().default(100),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    timeoutMs: integer("timeout_ms").notNull().default(30_000),
    retryBaseMs: integer("retry_base_ms").notNull().default(1_000),
    retryMaxMs: integer("retry_max_ms").notNull().default(60_000),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    workerId: varchar("worker_id", { length: 160 }),
    idempotencyKey: varchar("idempotency_key", { length: 240 }),
    result: jsonb("result"),
    lastErrorCode: varchar("last_error_code", { length: 120 }),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_jobs_org_id_uidx").on(table.organizationId, table.id),
    uniqueIndex("ai_jobs_org_idempotency_uidx")
      .on(table.organizationId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index("ai_jobs_claim_idx").on(table.status, table.availableAt, table.priority, table.createdAt),
    index("ai_jobs_expired_lease_idx").on(table.leaseExpiresAt),
    index("ai_jobs_org_status_idx").on(table.organizationId, table.status, table.createdAt),
  ],
);

export const aiJobEvents = pgTable(
  "ai_job_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    aiJobId: uuid("ai_job_id")
      .notNull()
      .references(() => aiJobs.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    attempt: integer("attempt").notNull().default(0),
    workerId: varchar("worker_id", { length: 160 }),
    details: jsonb("details").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_job_events_org_id_uidx").on(table.organizationId, table.id),
    index("ai_job_events_job_created_idx").on(table.organizationId, table.aiJobId, table.createdAt),
  ],
);
