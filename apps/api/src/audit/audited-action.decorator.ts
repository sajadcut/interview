import { SetMetadata } from "@nestjs/common";

export interface AuditedActionMetadata {
  action: string;
  entityType: string;
}

export const AUDITED_ACTION_KEY = "auditedAction";
export const AuditedAction = (action: string, entityType: string) =>
  SetMetadata(AUDITED_ACTION_KEY, { action, entityType } satisfies AuditedActionMetadata);
