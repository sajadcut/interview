import { index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
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
  ],
);
