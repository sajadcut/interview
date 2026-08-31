import { Injectable } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type { AuditRecordInput } from "./audit.types";

@Injectable()
export class AuditService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
  ) {}

  async record(input: AuditRecordInput): Promise<void> {
    const organizationId = this.tenantContext.require().organizationId;
    const principal = this.authContext.getOptional();
    const actorType = input.actorType ?? (principal ? "user" : "system");

    await this.database.sql`
      INSERT INTO audit_events (
        organization_id, actor_type, actor_user_id, action, entity_type, entity_id,
        reason, before, after, metadata
      ) VALUES (
        ${organizationId}::uuid,
        ${actorType},
        ${principal?.userId ?? null}::uuid,
        ${input.action},
        ${input.entityType},
        ${input.entityId ?? null},
        ${input.reason ?? null},
        ${input.before ? this.database.sql.json(input.before as never) : null},
        ${input.after ? this.database.sql.json(input.after as never) : null},
        ${input.metadata ? this.database.sql.json(input.metadata as never) : null}
      )
    `;
  }
}
