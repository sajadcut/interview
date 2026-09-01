import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./foundation";

export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    passwordHash: text("password_hash").notNull(),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).defaultNow().notNull(),
    resetRequired: boolean("reset_required").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("credentials_user_uq").on(table.userId)],
);

export const candidateIdentities = pgTable(
  "candidate_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").notNull(),
    identityType: varchar("identity_type", { length: 48 }).notNull(),
    normalizedValue: varchar("normalized_value", { length: 512 }).notNull(),
    isVerified: boolean("is_verified").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    temporary: boolean("temporary").notNull().default(false),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("candidate_identities_org_type_value_uq").on(
      table.organizationId,
      table.identityType,
      table.normalizedValue,
    ),
    uniqueIndex("candidate_identities_org_id_uq").on(table.organizationId, table.id),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    principalType: varchar("principal_type", { length: 24 }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    candidateIdentityId: uuid("candidate_identity_id"),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    userAgentHash: varchar("user_agent_hash", { length: 64 }),
    ipHash: varchar("ip_hash", { length: 64 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_uq").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
    index("sessions_candidate_idx").on(table.organizationId, table.candidateIdentityId),
    foreignKey({
      name: "sessions_candidate_identity_org_fk",
      columns: [table.organizationId, table.candidateIdentityId],
      foreignColumns: [candidateIdentities.organizationId, candidateIdentities.id],
    }).onDelete("cascade"),
  ],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    rotatedToId: uuid("rotated_to_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("refresh_tokens_token_hash_uq").on(table.tokenHash),
    index("refresh_tokens_session_idx").on(table.sessionId),
    index("refresh_tokens_family_idx").on(table.familyId),
  ],
);

export const invitationTokens = pgTable(
  "invitation_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    candidateIdentityId: uuid("candidate_identity_id"),
    targetEmail: varchar("target_email", { length: 320 }).notNull(),
    purpose: varchar("purpose", { length: 40 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    otpHash: varchar("otp_hash", { length: 64 }),
    roleKey: varchar("role_key", { length: 80 }),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("invitation_tokens_token_hash_uq").on(table.tokenHash),
    index("invitation_tokens_org_email_idx").on(table.organizationId, table.targetEmail),
    foreignKey({
      name: "invitation_tokens_candidate_identity_org_fk",
      columns: [table.organizationId, table.candidateIdentityId],
      foreignColumns: [candidateIdentities.organizationId, candidateIdentities.id],
    }).onDelete("cascade"),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_token_hash_uq").on(table.tokenHash),
    index("password_reset_tokens_user_idx").on(table.userId),
  ],
);
