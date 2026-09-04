import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { AtsConnectionService } from "./ats-connection.service";
import { AtsProviderError } from "./ats-http";
import type { AtsProvider, AtsProviderKey } from "./ats-provider.contracts";
import { GreenhouseAtsProvider } from "./greenhouse-ats.provider";
import { LeverAtsProvider } from "./lever-ats.provider";

function providerKey(value: string): AtsProviderKey {
  const normalized = value.trim().toLowerCase();
  if (normalized === "greenhouse" || normalized === "lever") return normalized;
  throw new BadRequestException("ATS provider must be greenhouse or lever");
}

function hashIdempotency(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorDetails(error: unknown) {
  if (error instanceof AtsProviderError) {
    return {
      code: error.code,
      message: error.message.slice(0, 1_000),
      retryable: error.retryable,
      outcomeUnknown: error.outcomeUnknown,
    };
  }
  return {
    code: "ATS_PROVIDER_FAILURE",
    message: error instanceof Error ? error.message.slice(0, 1_000) : "Unknown ATS provider failure",
    retryable: true,
    outcomeUnknown: false,
  };
}

@Injectable()
export class AtsIntegrationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly connections: AtsConnectionService,
    private readonly greenhouse: GreenhouseAtsProvider,
    private readonly lever: LeverAtsProvider,
  ) {}

  async listProviders() {
    const organizationId = this.tenantContext.require().organizationId;
    return Promise.all((["greenhouse", "lever"] as const).map(async (key) => {
      const provider = this.provider(key);
      const connection = await this.connections.find(organizationId, key);
      return {
        provider: key,
        implementation: "installed",
        configured: await provider.isConfiguredFor(organizationId),
        connectionStatus: connection?.status ?? "not_configured",
        credentialReference: connection?.credentialReference ?? null,
        config: connection?.config ?? {},
      };
    }));
  }

  async verify(rawProvider: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const key = providerKey(rawProvider);
    const provider = this.provider(key);
    const connection = await this.connections.require(organizationId, key);
    const started = new Date();
    try {
      const result = await provider.verify(organizationId);
      await this.database.sql`
        INSERT INTO ats_operation_attempts (
          organization_id, provider_key, integration_id, operation, state, started_at, completed_at
        ) VALUES (
          ${organizationId}::uuid, ${key}, ${connection.id}::uuid, 'verify', 'succeeded', ${started}, now()
        )
      `;
      await this.database.sql`
        UPDATE integration_connections
        SET status = 'verified', last_verified_at = now(), last_error = NULL, updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${connection.id}::uuid
      `;
      return { ...result, verifiedAt: new Date().toISOString() };
    } catch (error) {
      const details = errorDetails(error);
      await this.database.sql`
        INSERT INTO ats_operation_attempts (
          organization_id, provider_key, integration_id, operation, state,
          error_code, error_message, retryable, started_at, completed_at
        ) VALUES (
          ${organizationId}::uuid, ${key}, ${connection.id}::uuid, 'verify', 'failed',
          ${details.code}, ${details.message}, ${details.retryable}, ${started}, now()
        )
      `;
      await this.database.sql`
        UPDATE integration_connections
        SET status = 'degraded', last_error = ${details.message}, updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${connection.id}::uuid
      `;
      this.throwProviderFailure(details);
    }
  }

  async listJobs(rawProvider: string, rawLimit = 100) {
    const organizationId = this.tenantContext.require().organizationId;
    const key = providerKey(rawProvider);
    const provider = this.provider(key);
    const connection = await this.connections.require(organizationId, key);
    const limit = Math.max(1, Math.min(500, Math.floor(rawLimit)));
    const started = new Date();
    try {
      const jobs = await provider.listJobs(organizationId, limit);
      await this.database.sql`
        INSERT INTO ats_operation_attempts (
          organization_id, provider_key, integration_id, operation, state, started_at, completed_at
        ) VALUES (
          ${organizationId}::uuid, ${key}, ${connection.id}::uuid, 'list_jobs', 'succeeded', ${started}, now()
        )
      `;
      return jobs;
    } catch (error) {
      const details = errorDetails(error);
      await this.database.sql`
        INSERT INTO ats_operation_attempts (
          organization_id, provider_key, integration_id, operation, state,
          error_code, error_message, retryable, started_at, completed_at
        ) VALUES (
          ${organizationId}::uuid, ${key}, ${connection.id}::uuid, 'list_jobs', 'failed',
          ${details.code}, ${details.message}, ${details.retryable}, ${started}, now()
        )
      `;
      this.throwProviderFailure(details);
    }
  }

  async linkJob(rawProvider: string, jobId: string, providerJobReference: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const key = providerKey(rawProvider);
    await this.connections.require(organizationId, key);
    const reference = providerJobReference.trim();
    if (!reference) throw new BadRequestException("providerJobReference is required");
    const jobs = await this.database.sql`
      SELECT id::text FROM jobs
      WHERE organization_id = ${organizationId}::uuid AND id = ${jobId}::uuid
      LIMIT 1
    `;
    if (!jobs[0]) throw new NotFoundException("Job not found");
    const rows = await this.database.sql`
      INSERT INTO ats_job_links (organization_id, provider_key, job_id, provider_job_reference)
      VALUES (${organizationId}::uuid, ${key}, ${jobId}::uuid, ${reference})
      ON CONFLICT (organization_id, provider_key, job_id) DO UPDATE
      SET provider_job_reference = EXCLUDED.provider_job_reference, updated_at = now()
      RETURNING id::text, provider_key, job_id::text, provider_job_reference, updated_at
    `;
    return rows[0];
  }

  async exportApplication(rawProvider: string, applicationId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const key = providerKey(rawProvider);
    const provider = this.provider(key);
    const connection = await this.connections.require(organizationId, key);
    const idempotencyKey = `ats:export:${organizationId}:${key}:${applicationId}`;
    const idempotencyHash = hashIdempotency(idempotencyKey);

    const outcome = await this.database.sql.begin(async (tx) => {
      const applications = await tx`
        SELECT
          a.id::text AS application_id,
          a.job_id::text,
          a.candidate_id::text,
          c.display_name,
          c.primary_email,
          c.primary_phone,
          c.current_company,
          c."current_role" AS current_role,
          jl.provider_job_reference
        FROM applications a
        JOIN candidates c
          ON c.organization_id = a.organization_id AND c.id = a.candidate_id
        LEFT JOIN ats_job_links jl
          ON jl.organization_id = a.organization_id
         AND jl.provider_key = ${key}
         AND jl.job_id = a.job_id
        WHERE a.organization_id = ${organizationId}::uuid AND a.id = ${applicationId}::uuid
        LIMIT 1
        FOR UPDATE OF a
      `;
      const application = applications[0];
      if (!application) throw new NotFoundException("Application not found");
      if (!application.provider_job_reference) {
        throw new BadRequestException(`Link the local job to a ${key} job before exporting the application`);
      }

      const links = await tx`
        SELECT provider_candidate_reference, provider_application_reference,
               provider_job_reference, remote_stage_reference, sync_state, last_synced_at
        FROM ats_application_links
        WHERE organization_id = ${organizationId}::uuid
          AND provider_key = ${key}
          AND application_id = ${applicationId}::uuid
        LIMIT 1
      `;
      if (links[0]) {
        return { ok: true as const, replay: true, link: links[0] };
      }

      const unknown = await tx`
        SELECT id::text
        FROM ats_operation_attempts
        WHERE organization_id = ${organizationId}::uuid
          AND provider_key = ${key}
          AND application_id = ${applicationId}::uuid
          AND operation = 'export_application'
          AND state = 'outcome_unknown'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (unknown[0]) {
        throw new ConflictException(
          "A previous ATS export ended with an unknown remote outcome. Reconcile the provider record before retrying to avoid creating a duplicate.",
        );
      }

      const started = new Date();
      try {
        const result = await provider.exportApplication(organizationId, {
          applicationId,
          candidateId: String(application.candidate_id),
          jobId: String(application.job_id),
          displayName: String(application.display_name),
          ...(application.primary_email ? { primaryEmail: String(application.primary_email) } : {}),
          ...(application.primary_phone ? { primaryPhone: String(application.primary_phone) } : {}),
          ...(application.current_company ? { currentCompany: String(application.current_company) } : {}),
          ...(application.current_role ? { currentRole: String(application.current_role) } : {}),
          providerJobReference: String(application.provider_job_reference),
          idempotencyKey,
        });
        await tx`
          INSERT INTO ats_application_links (
            organization_id, provider_key, application_id, provider_job_reference,
            provider_candidate_reference, provider_application_reference, sync_state, last_synced_at
          ) VALUES (
            ${organizationId}::uuid, ${key}, ${applicationId}::uuid,
            ${result.providerJobReference}, ${result.providerCandidateReference},
            ${result.providerApplicationReference}, 'linked', now()
          )
          ON CONFLICT (organization_id, provider_key, application_id) DO UPDATE
          SET provider_job_reference = EXCLUDED.provider_job_reference,
              provider_candidate_reference = EXCLUDED.provider_candidate_reference,
              provider_application_reference = EXCLUDED.provider_application_reference,
              sync_state = 'linked', last_synced_at = now(), updated_at = now()
        `;
        await tx`
          INSERT INTO ats_operation_attempts (
            organization_id, provider_key, integration_id, application_id, job_id,
            operation, state, idempotency_key_hash, provider_job_reference,
            provider_candidate_reference, provider_application_reference,
            retryable, started_at, completed_at
          ) VALUES (
            ${organizationId}::uuid, ${key}, ${connection.id}::uuid,
            ${applicationId}::uuid, ${String(application.job_id)}::uuid,
            'export_application', 'succeeded', ${idempotencyHash},
            ${result.providerJobReference}, ${result.providerCandidateReference},
            ${result.providerApplicationReference}, false, ${started}, now()
          )
        `;
        return { ok: true as const, replay: result.deduplicated, link: result };
      } catch (error) {
        const details = errorDetails(error);
        await tx`
          INSERT INTO ats_operation_attempts (
            organization_id, provider_key, integration_id, application_id, job_id,
            operation, state, idempotency_key_hash, provider_job_reference,
            error_code, error_message, retryable, started_at, completed_at
          ) VALUES (
            ${organizationId}::uuid, ${key}, ${connection.id}::uuid,
            ${applicationId}::uuid, ${String(application.job_id)}::uuid,
            'export_application', ${details.outcomeUnknown ? "outcome_unknown" : "failed"},
            ${idempotencyHash}, ${String(application.provider_job_reference)},
            ${details.code}, ${details.message}, ${details.retryable}, ${started}, now()
          )
        `;
        return { ok: false as const, details };
      }
    });

    if (!outcome.ok) {
      await this.markDegraded(organizationId, connection.id, outcome.details.message);
      this.throwProviderFailure(outcome.details);
    }
    return { provider: key, idempotentReplay: outcome.replay, ...outcome.link };
  }

  async updateStage(
    rawProvider: string,
    applicationId: string,
    targetStageReference: string,
    currentStageReference?: string,
  ) {
    const organizationId = this.tenantContext.require().organizationId;
    const key = providerKey(rawProvider);
    const provider = this.provider(key);
    const connection = await this.connections.require(organizationId, key);
    const target = targetStageReference.trim();
    if (!target) throw new BadRequestException("targetStageReference is required");
    const links = await this.database.sql`
      SELECT provider_application_reference, provider_job_reference, remote_stage_reference
      FROM ats_application_links
      WHERE organization_id = ${organizationId}::uuid
        AND provider_key = ${key}
        AND application_id = ${applicationId}::uuid
      LIMIT 1
    `;
    const link = links[0];
    if (!link) throw new NotFoundException("ATS application link not found; export the application first");
    const current = currentStageReference?.trim() || (link.remote_stage_reference ? String(link.remote_stage_reference) : undefined);
    const idempotencyHash = hashIdempotency(`ats:stage:${organizationId}:${key}:${applicationId}:${current ?? "unknown"}:${target}`);
    const started = new Date();
    try {
      await provider.updateStage(organizationId, {
        providerApplicationReference: String(link.provider_application_reference),
        ...(current ? { currentStageReference: current } : {}),
        targetStageReference: target,
        idempotencyKey: idempotencyHash,
      });
      await this.database.sql`
        UPDATE ats_application_links
        SET remote_stage_reference = ${target}, sync_state = 'linked', last_synced_at = now(), updated_at = now()
        WHERE organization_id = ${organizationId}::uuid
          AND provider_key = ${key}
          AND application_id = ${applicationId}::uuid
      `;
      await this.database.sql`
        INSERT INTO ats_operation_attempts (
          organization_id, provider_key, integration_id, application_id,
          operation, state, idempotency_key_hash, provider_job_reference,
          provider_application_reference, retryable, started_at, completed_at
        ) VALUES (
          ${organizationId}::uuid, ${key}, ${connection.id}::uuid, ${applicationId}::uuid,
          'update_stage', 'succeeded', ${idempotencyHash}, ${String(link.provider_job_reference)},
          ${String(link.provider_application_reference)}, false, ${started}, now()
        )
      `;
      return { provider: key, applicationId, targetStageReference: target, syncedAt: new Date().toISOString() };
    } catch (error) {
      const details = errorDetails(error);
      await this.database.sql`
        UPDATE ats_application_links
        SET sync_state = ${details.outcomeUnknown ? "outcome_unknown" : "degraded"}, updated_at = now()
        WHERE organization_id = ${organizationId}::uuid
          AND provider_key = ${key}
          AND application_id = ${applicationId}::uuid
      `;
      await this.database.sql`
        INSERT INTO ats_operation_attempts (
          organization_id, provider_key, integration_id, application_id,
          operation, state, idempotency_key_hash, provider_job_reference,
          provider_application_reference, error_code, error_message, retryable,
          started_at, completed_at
        ) VALUES (
          ${organizationId}::uuid, ${key}, ${connection.id}::uuid, ${applicationId}::uuid,
          'update_stage', ${details.outcomeUnknown ? "outcome_unknown" : "failed"}, ${idempotencyHash},
          ${String(link.provider_job_reference)}, ${String(link.provider_application_reference)},
          ${details.code}, ${details.message}, ${details.retryable}, ${started}, now()
        )
      `;
      await this.markDegraded(organizationId, connection.id, details.message);
      this.throwProviderFailure(details);
    }
  }

  async listApplicationLinks(applicationId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    return this.database.sql`
      SELECT provider_key, provider_job_reference, provider_candidate_reference,
             provider_application_reference, remote_stage_reference, sync_state,
             last_synced_at, created_at, updated_at
      FROM ats_application_links
      WHERE organization_id = ${organizationId}::uuid AND application_id = ${applicationId}::uuid
      ORDER BY provider_key
    `;
  }

  private provider(key: AtsProviderKey): AtsProvider {
    return key === "greenhouse" ? this.greenhouse : this.lever;
  }

  private async markDegraded(organizationId: string, integrationId: string, message: string) {
    await this.database.sql`
      UPDATE integration_connections
      SET status = 'degraded', last_error = ${message.slice(0, 1_000)}, updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${integrationId}::uuid
    `;
  }

  private throwProviderFailure(details: { code: string; message: string; retryable: boolean; outcomeUnknown?: boolean }): never {
    if (details.outcomeUnknown) throw new ConflictException(`${details.code}: ${details.message}`);
    if (details.retryable) throw new ServiceUnavailableException(`${details.code}: ${details.message}`);
    throw new BadRequestException(`${details.code}: ${details.message}`);
  }
}
