import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { Permissions } from "../auth/permissions";
import { TenantAccessService } from "../auth/tenant-access.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type {
  CreateAutomationRuleDto,
  CreateAutomationRunDto,
  CreateIntegrationDto,
  UpdateAutomationRuleDto,
  UpdateIntegrationDto,
  UpdateOrganizationSettingsDto,
} from "./product-operations.dto";

const CREDENTIAL_REFERENCE = /^(vault|secret|env|external):\/\/[A-Za-z0-9._~:/?#\u005B\u005D@!$&'()*+,;=%-]+$/;

function actor(auth: AuthContextService): string {
  const userId = auth.getOptional()?.userId;
  if (!userId) throw new BadRequestException("Authenticated user context is required");
  return userId;
}

function validateCredentialReference(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!CREDENTIAL_REFERENCE.test(normalized)) {
    throw new BadRequestException(
      "credentialReference must reference an external secret (vault://, secret://, env:// or external://); raw credentials are not accepted",
    );
  }
  return normalized;
}

@Injectable()
export class ProductOperationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
    private readonly tenantAccess: TenantAccessService,
  ) {}

  async getSettings() {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT organization_id::text, default_locale, timezone, hiring_policy,
             notification_preferences, updated_by_user_id::text, updated_at
      FROM organization_settings
      WHERE organization_id = ${organizationId}::uuid
      LIMIT 1
    `;
    return rows[0] ?? {
      organization_id: organizationId,
      default_locale: "en",
      timezone: "UTC",
      hiring_policy: {},
      notification_preferences: {},
      updated_by_user_id: null,
      updated_at: null,
    };
  }

  async updateSettings(input: UpdateOrganizationSettingsDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actor(this.authContext);
    const current = await this.getSettings();
    const defaultLocale = input.defaultLocale?.trim() || String(current.default_locale ?? "en");
    const timezone = input.timezone?.trim() || String(current.timezone ?? "UTC");
    const hiringPolicy = input.hiringPolicy ?? (current.hiring_policy as Record<string, unknown> | undefined) ?? {};
    const notificationPreferences =
      input.notificationPreferences ??
      (current.notification_preferences as Record<string, unknown> | undefined) ??
      {};
    const rows = await this.database.sql`
      INSERT INTO organization_settings (
        organization_id, default_locale, timezone, hiring_policy,
        notification_preferences, updated_by_user_id, updated_at
      ) VALUES (
        ${organizationId}::uuid,
        ${defaultLocale},
        ${timezone},
        ${this.database.sql.json(hiringPolicy as never)},
        ${this.database.sql.json(notificationPreferences as never)},
        ${userId}::uuid,
        now()
      )
      ON CONFLICT (organization_id) DO UPDATE
      SET default_locale = EXCLUDED.default_locale,
          timezone = EXCLUDED.timezone,
          hiring_policy = EXCLUDED.hiring_policy,
          notification_preferences = EXCLUDED.notification_preferences,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = now()
      RETURNING organization_id::text, default_locale, timezone, hiring_policy,
                notification_preferences, updated_by_user_id::text, updated_at
    `;
    return rows[0];
  }

  async listIntegrations() {
    const organizationId = this.tenantContext.require().organizationId;
    return this.database.sql`
      SELECT id::text, provider_key, connection_type, status, credential_reference,
             config, last_verified_at, last_error, created_at, updated_at
      FROM integration_connections
      WHERE organization_id = ${organizationId}::uuid
      ORDER BY provider_key, connection_type
    `;
  }

  async createIntegration(input: CreateIntegrationDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actor(this.authContext);
    const credentialReference = validateCredentialReference(input.credentialReference);
    const rows = await this.database.sql`
      INSERT INTO integration_connections (
        organization_id, provider_key, connection_type, status,
        credential_reference, config, created_by_user_id
      ) VALUES (
        ${organizationId}::uuid,
        ${input.providerKey.trim().toLowerCase()},
        ${input.connectionType.trim().toLowerCase()},
        'configured',
        ${credentialReference},
        ${this.database.sql.json((input.config ?? {}) as never)},
        ${userId}::uuid
      )
      ON CONFLICT (organization_id, provider_key, connection_type) DO UPDATE
      SET credential_reference = EXCLUDED.credential_reference,
          config = EXCLUDED.config,
          status = 'configured',
          last_error = NULL,
          updated_at = now()
      RETURNING id::text, provider_key, connection_type, status, credential_reference,
                config, last_verified_at, last_error, created_at, updated_at
    `;
    return rows[0];
  }

  async updateIntegration(integrationId: string, input: UpdateIntegrationDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const integrations = await this.database.sql`
      SELECT credential_reference, config, status
      FROM integration_connections
      WHERE organization_id = ${organizationId}::uuid AND id = ${integrationId}::uuid
      LIMIT 1
    `;
    const current = integrations[0];
    if (!current) throw new NotFoundException("Integration not found");
    const credentialReference = input.credentialReference
      ? validateCredentialReference(input.credentialReference)
      : current.credential_reference
        ? String(current.credential_reference)
        : null;
    const config = input.config ?? (current.config as Record<string, unknown> | undefined) ?? {};
    const status = input.status ?? String(current.status);
    const rows = await this.database.sql`
      UPDATE integration_connections
      SET credential_reference = ${credentialReference},
          config = ${this.database.sql.json(config as never)},
          status = ${status},
          updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${integrationId}::uuid
      RETURNING id::text, provider_key, connection_type, status, credential_reference,
                config, last_verified_at, last_error, created_at, updated_at
    `;
    return rows[0];
  }

  async listAutomations() {
    const organizationId = this.tenantContext.require().organizationId;
    const rules = await this.database.sql`
      SELECT id::text, name, description, trigger_type, trigger_config,
             action_type, action_config, approval_required, enabled, created_at, updated_at
      FROM automation_rules
      WHERE organization_id = ${organizationId}::uuid
      ORDER BY updated_at DESC
    `;
    const runs = await this.database.sql`
      SELECT id::text, rule_id::text, trigger_reference, idempotency_key, state,
             input, output, error_message, approved_at, started_at, completed_at, created_at
      FROM automation_runs
      WHERE organization_id = ${organizationId}::uuid
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return { rules, runs };
  }

  async createAutomation(input: CreateAutomationRuleDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actor(this.authContext);
    const rows = await this.database.sql`
      INSERT INTO automation_rules (
        organization_id, name, description, trigger_type, trigger_config,
        action_type, action_config, approval_required, enabled, created_by_user_id
      ) VALUES (
        ${organizationId}::uuid,
        ${input.name.trim()},
        ${input.description?.trim() || null},
        ${input.triggerType.trim()},
        ${this.database.sql.json((input.triggerConfig ?? {}) as never)},
        ${input.actionType.trim()},
        ${this.database.sql.json((input.actionConfig ?? {}) as never)},
        ${input.approvalRequired ?? true},
        false,
        ${userId}::uuid
      )
      RETURNING id::text, name, description, trigger_type, trigger_config,
                action_type, action_config, approval_required, enabled, created_at, updated_at
    `;
    return rows[0];
  }

  async updateAutomation(ruleId: string, input: UpdateAutomationRuleDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const rules = await this.database.sql`
      SELECT enabled, approval_required
      FROM automation_rules
      WHERE organization_id = ${organizationId}::uuid AND id = ${ruleId}::uuid
      LIMIT 1
    `;
    const current = rules[0];
    if (!current) throw new NotFoundException("Automation rule not found");
    const enabled = input.enabled ?? Boolean(current.enabled);
    const approvalRequired = input.approvalRequired ?? Boolean(current.approval_required);
    const rows = await this.database.sql`
      UPDATE automation_rules
      SET enabled = ${enabled}, approval_required = ${approvalRequired}, updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${ruleId}::uuid
      RETURNING id::text, name, trigger_type, action_type, approval_required, enabled, updated_at
    `;
    return rows[0];
  }

  async createAutomationRun(ruleId: string, input: CreateAutomationRunDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const rules = await this.database.sql`
      SELECT id::text, enabled, approval_required
      FROM automation_rules
      WHERE organization_id = ${organizationId}::uuid AND id = ${ruleId}::uuid
      LIMIT 1
    `;
    const rule = rules[0];
    if (!rule) throw new NotFoundException("Automation rule not found");
    if (!rule.enabled) throw new BadRequestException("Automation rule is disabled");
    const state = rule.approval_required ? "approval_required" : "queued";
    const rows = await this.database.sql`
      INSERT INTO automation_runs (
        organization_id, rule_id, trigger_reference, idempotency_key, state, input
      ) VALUES (
        ${organizationId}::uuid,
        ${ruleId}::uuid,
        ${input.triggerReference?.trim() || null},
        ${input.idempotencyKey.trim()},
        ${state},
        ${this.database.sql.json((input.input ?? {}) as never)}
      )
      ON CONFLICT (organization_id, idempotency_key) DO UPDATE
      SET idempotency_key = EXCLUDED.idempotency_key
      RETURNING id::text, rule_id::text, trigger_reference, idempotency_key, state, input, created_at
    `;
    return {
      ...rows[0],
      executionBoundary:
        "The core platform persists and approves the run; external/provider actions execute only through an explicitly configured worker or integration.",
    };
  }

  async approveAutomationRun(runId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actor(this.authContext);
    const rows = await this.database.sql`
      UPDATE automation_runs
      SET state = 'approved', approved_by_user_id = ${userId}::uuid, approved_at = now()
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${runId}::uuid
        AND state = 'approval_required'
      RETURNING id::text, rule_id::text, state, approved_by_user_id::text, approved_at
    `;
    if (!rows[0]) throw new NotFoundException("Automation run awaiting approval not found");
    return rows[0];
  }

  async search(query: string) {
    const q = query.trim();
    if (q.length < 2) return [];
    const organizationId = this.tenantContext.require().organizationId;
    const access = await this.tenantAccess.requireCurrentAccess();
    const pattern = `%${q.slice(0, 120)}%`;
    const results: Array<Record<string, unknown>> = [];

    if (access.permissions.has(Permissions.JobRead)) {
      const jobs = await this.database.sql`
        SELECT id::text, title, department, status
        FROM jobs
        WHERE organization_id = ${organizationId}::uuid
          AND (title ILIKE ${pattern} OR COALESCE(department, '') ILIKE ${pattern})
        ORDER BY updated_at DESC
        LIMIT 20
      `;
      for (const row of jobs) results.push({ type: "job", id: row.id, title: row.title, subtitle: row.department ?? row.status, href: `/app/jobs/${String(row.id)}` });
    }

    if (access.permissions.has(Permissions.CandidateRead)) {
      const candidates = await this.database.sql`
        SELECT id::text, display_name, "current_role", current_company
        FROM candidates
        WHERE organization_id = ${organizationId}::uuid
          AND (display_name ILIKE ${pattern}
               OR COALESCE("current_role", '') ILIKE ${pattern}
               OR COALESCE(current_company, '') ILIKE ${pattern})
        ORDER BY updated_at DESC
        LIMIT 20
      `;
      for (const row of candidates) results.push({ type: "candidate", id: row.id, title: row.display_name, subtitle: row.current_role ?? row.current_company ?? "Candidate", href: `/app/candidates/${String(row.id)}` });
    }

    if (access.permissions.has(Permissions.InterviewRead)) {
      const interviews = await this.database.sql`
        SELECT s.id::text, s.status, c.display_name, j.title AS job_title
        FROM interview_sessions s
        JOIN applications a ON a.organization_id = s.organization_id AND a.id = s.application_id
        JOIN candidates c ON c.organization_id = a.organization_id AND c.id = a.candidate_id
        JOIN jobs j ON j.organization_id = a.organization_id AND j.id = a.job_id
        WHERE s.organization_id = ${organizationId}::uuid
          AND (c.display_name ILIKE ${pattern} OR j.title ILIKE ${pattern})
        ORDER BY s.created_at DESC
        LIMIT 20
      `;
      for (const row of interviews) results.push({ type: "interview", id: row.id, title: `${String(row.display_name)} · ${String(row.job_title)}`, subtitle: row.status, href: `/app/interviews` });
    }

    return results.slice(0, 50);
  }

  async listAuditEvents(action?: string, entityType?: string, rawLimit = 100) {
    const organizationId = this.tenantContext.require().organizationId;
    const limit = Math.max(1, Math.min(250, Math.floor(rawLimit)));
    const actionFilter = action?.trim() || null;
    const entityFilter = entityType?.trim() || null;
    return this.database.sql`
      SELECT id::text, actor_type, actor_user_id::text, action, entity_type, entity_id,
             metadata, created_at
      FROM audit_events
      WHERE organization_id = ${organizationId}::uuid
        AND (${actionFilter}::text IS NULL OR action = ${actionFilter})
        AND (${entityFilter}::text IS NULL OR entity_type = ${entityFilter})
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }
}
