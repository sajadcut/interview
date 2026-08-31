import { bigint, index, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./foundation";

export const files = pgTable(
  "files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    storageKey: varchar("storage_key", { length: 500 }).notNull(),
    originalName: varchar("original_name", { length: 500 }).notNull(),
    mimeType: varchar("mime_type", { length: 200 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("files_org_idx").on(table.organizationId),
    index("files_storage_key_idx").on(table.storageKey),
  ],
);
