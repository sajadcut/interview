import { BadRequestException, Injectable } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type { AuditExportQueryDto } from "./audit-export.dto";
import type { AuditRecordInput } from "./audit.types";

function nullableRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

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

  async exportEvents(query: AuditExportQueryDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const from = query.from ?? null;
    const to = query.to ?? null;
    if (from && to && Date.parse(from) > Date.parse(to)) {
      throw new BadRequestException("Audit export 'from' must be before or equal to 'to'");
    }

    const limit = query.limit ?? 1_000;
    const rows = await this.database.sql`
      SELECT
        id,
        actor_type,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        reason,
        before,
        after,
        metadata,
        created_at
      FROM audit_events
      WHERE organization_id = ${organizationId}::uuid
        AND (${from}::timestamptz IS NULL OR created_at >= ${from}::timestamptz)
        AND (${to}::timestamptz IS NULL OR created_at <= ${to}::timestamptz)
        AND (${query.action ?? null}::text IS NULL OR action = ${query.action ?? null})
        AND (${query.entityType ?? null}::text IS NULL OR entity_type = ${query.entityType ?? null})
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit + 1}
    `;

    const truncated = rows.length > limit;
    const selected = truncated ? rows.slice(0, limit) : rows;
    return {
      exportedAt: new Date().toISOString(),
      organizationId,
      filters: {
        from,
        to,
        action: query.action ?? null,
        entityType: query.entityType ?? null,
        limit,
      },
      count: selected.length,
      truncated,
      events: selected.map((row) => ({
        id: String(row?.id),
        actorType: String(row?.actor_type),
        actorUserId: row?.actor_user_id ? String(row.actor_user_id) : null,
        action: String(row?.action),
        entityType: String(row?.entity_type),
        entityId: row?.entity_id ? String(row.entity_id) : null,
        reason: row?.reason ? String(row.reason) : null,
        before: nullableRecord(row?.before),
        after: nullableRecord(row?.after),
        metadata: nullableRecord(row?.metadata),
        createdAt: new Date(String(row?.created_at)).toISOString(),
      })),
    };
  }
}
