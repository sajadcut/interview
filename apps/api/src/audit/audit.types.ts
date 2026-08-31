export interface AuditRecordInput {
  action: string;
  entityType: string;
  entityId?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  actorType?: "user" | "system" | "ai";
}
