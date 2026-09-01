import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { ApprovedSourceTypes, type CandidateSourceResult } from "./candidate-source.adapter";
import { SOURCE_POLICY_VERSION } from "./source-policy";
import { candidateDiscoveryFingerprint } from "./sourcing-fingerprint";
import type { SourcingImportRequestDto } from "./sourcing-import-export.dto";

const EXPORT_SCHEMA_VERSION = "sourcing-export-v1";
const MAX_IMPORT_CANDIDATES = 500;

function actorId(auth: AuthContextService): string {
  const userId = auth.getOptional()?.userId;
  if (!userId) throw new BadRequestException("Authenticated user context is required");
  return userId;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

@Injectable()
export class SourcingImportExportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
  ) {}

  async importCandidates(jobId: string, input: SourcingImportRequestDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    if (input.candidates.length === 0 || input.candidates.length > MAX_IMPORT_CANDIDATES) {
      throw new BadRequestException(`Import must contain between 1 and ${MAX_IMPORT_CANDIDATES} candidates`);
    }
    const providerKey = input.providerKey.trim().toLowerCase();
    if (!providerKey) throw new BadRequestException("providerKey is required");
    const requiresApproval = input.sourceType !== ApprovedSourceTypes.InternalTalentPool;
    if (requiresApproval && input.approvalConfirmed !== true) {
      throw new ForbiddenException("Non-internal candidate imports require explicit human approval");
    }

    const jobRows = await this.database.sql`
      SELECT id::text FROM jobs
      WHERE organization_id = ${organizationId}::uuid AND id = ${jobId}::uuid
      LIMIT 1
    `;
    if (!jobRows[0]) throw new NotFoundException("Job not found");

    return this.database.sql.begin(async (tx) => {
      const runRows = await tx`
        INSERT INTO sourcing_runs (
          organization_id, job_id, status, strategy, approved_by_user_id,
          requested_by_user_id, requested_source_type, source_policy_version,
          attempt_count, started_at
        ) VALUES (
          ${organizationId}::uuid,
          ${jobId}::uuid,
          'running',
          ${this.database.sql.json({
            mode: "import",
            providerKey,
            sourceType: input.sourceType,
            retrievalOnly: true,
            sourcePolicyVersion: SOURCE_POLICY_VERSION,
          } as never)},
          ${requiresApproval ? userId : null}::uuid,
          ${userId}::uuid,
          ${input.sourceType},
          ${SOURCE_POLICY_VERSION},
          1,
          now()
        )
        RETURNING id::text
      `;
      const runId = String(runRows[0]?.id ?? "");
      if (!runId) throw new Error("Unable to create sourcing import run");

      const attemptRows = await tx`
        INSERT INTO sourcing_source_attempts (
          organization_id, sourcing_run_id, source_type, provider_key,
          attempt_no, state, result_count, started_at
        ) VALUES (
          ${organizationId}::uuid,
          ${runId}::uuid,
          ${input.sourceType},
          ${providerKey},
          1,
          'running',
          0,
          now()
        )
        RETURNING id::text
      `;
      const attemptId = String(attemptRows[0]?.id ?? "");

      for (const candidate of input.candidates) {
        if (candidate.candidateId) {
          const candidateRows = await tx`
            SELECT 1 FROM candidates
            WHERE organization_id = ${organizationId}::uuid
              AND id = ${candidate.candidateId}::uuid
            LIMIT 1
          `;
          if (!candidateRows[0]) {
            throw new BadRequestException(`Candidate ${candidate.candidateId} does not belong to this organization`);
          }
        }

        const observedAt = new Date(candidate.observedAt);
        if (Number.isNaN(observedAt.getTime())) {
          throw new BadRequestException(`Invalid observedAt for ${candidate.displayName}`);
        }
        const email = candidate.normalizedEmail?.trim().toLowerCase();
        const phone = candidate.normalizedPhone?.trim();
        const result: CandidateSourceResult = {
          sourceType: input.sourceType,
          ...(candidate.sourceExternalKey ? { sourceExternalKey: candidate.sourceExternalKey.trim() } : {}),
          ...(candidate.candidateId ? { candidateId: candidate.candidateId } : {}),
          displayName: candidate.displayName.trim(),
          ...(candidate.currentRole ? { currentRole: candidate.currentRole.trim() } : {}),
          ...(candidate.currentCompany ? { currentCompany: candidate.currentCompany.trim() } : {}),
          skills: candidate.skills.map((skill) => skill.trim()).filter(Boolean),
          retrievalScore: candidate.retrievalScore ?? 0,
          evidenceSummary: candidate.evidenceReferences,
          ...(email || phone
            ? { normalizedIdentity: { ...(email ? { email } : {}), ...(phone ? { phone } : {}) } }
            : {}),
          provenance: {
            providerKey,
            sourceType: input.sourceType,
            observedAt: observedAt.toISOString(),
            retrievedAt: new Date().toISOString(),
            ...(candidate.sourceExternalKey ? { externalKey: candidate.sourceExternalKey.trim() } : {}),
            ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
            evidenceReferences: candidate.evidenceReferences.map((reference) => reference.trim()).filter(Boolean),
          },
        };
        const fingerprint = candidateDiscoveryFingerprint(result);
        await tx`
          INSERT INTO discovered_candidates (
            organization_id, sourcing_run_id, candidate_id, source_type,
            source_external_key, normalized_identity, profile_snapshot,
            retrieval_score, dedupe_state, review_state, discovery_fingerprint,
            source_provenance, source_observed_at
          ) VALUES (
            ${organizationId}::uuid,
            ${runId}::uuid,
            ${result.candidateId ?? null}::uuid,
            ${result.sourceType},
            ${result.sourceExternalKey ?? result.provenance.externalKey ?? null},
            ${this.database.sql.json((result.normalizedIdentity ?? {}) as never)},
            ${this.database.sql.json({
              displayName: result.displayName,
              currentRole: result.currentRole,
              currentCompany: result.currentCompany,
              skills: result.skills,
              evidenceSummary: result.evidenceSummary,
            } as never)},
            ${result.retrievalScore},
            ${result.candidateId ? "resolved_internal" : "unresolved"},
            'new',
            ${fingerprint},
            ${this.database.sql.json(result.provenance as never)},
            ${observedAt}
          )
          ON CONFLICT (organization_id, sourcing_run_id, discovery_fingerprint)
            WHERE discovery_fingerprint IS NOT NULL
          DO UPDATE SET
            candidate_id = COALESCE(EXCLUDED.candidate_id, discovered_candidates.candidate_id),
            source_external_key = COALESCE(EXCLUDED.source_external_key, discovered_candidates.source_external_key),
            normalized_identity = EXCLUDED.normalized_identity,
            profile_snapshot = EXCLUDED.profile_snapshot,
            retrieval_score = EXCLUDED.retrieval_score,
            source_provenance = EXCLUDED.source_provenance,
            source_observed_at = EXCLUDED.source_observed_at
        `;
      }

      const countRows = await tx`
        SELECT count(*)::int AS count FROM discovered_candidates
        WHERE organization_id = ${organizationId}::uuid AND sourcing_run_id = ${runId}::uuid
      `;
      const importedCount = Number(countRows[0]?.count ?? 0);
      await tx`
        UPDATE sourcing_source_attempts
        SET state = 'succeeded', result_count = ${importedCount}, completed_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${attemptId}::uuid
      `;
      await tx`
        UPDATE sourcing_runs
        SET status = 'succeeded', result_count = ${importedCount}, completed_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${runId}::uuid
      `;
      return { runId, importedCount, sourceType: input.sourceType, providerKey, status: "succeeded" as const };
    });
  }

  async exportRun(runId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const runs = await this.database.sql`
      SELECT id::text, job_id::text, status, strategy, requested_source_type,
             source_policy_version, idempotency_key, attempt_count, result_count,
             created_at, started_at, completed_at
      FROM sourcing_runs
      WHERE organization_id = ${organizationId}::uuid AND id = ${runId}::uuid
      LIMIT 1
    `;
    if (!runs[0]) throw new NotFoundException("Sourcing run not found");
    const attempts = await this.database.sql`
      SELECT attempt_no, source_type, provider_key, state, idempotency_key,
             result_count, provider_reference, error_message, started_at, completed_at
      FROM sourcing_source_attempts
      WHERE organization_id = ${organizationId}::uuid AND sourcing_run_id = ${runId}::uuid
      ORDER BY attempt_no
    `;
    const candidates = await this.database.sql`
      SELECT id::text, candidate_id::text, source_type, source_external_key,
             normalized_identity, profile_snapshot, retrieval_score,
             pre_interview_match_score, dedupe_state, review_state,
             discovery_fingerprint, source_provenance, source_observed_at, created_at
      FROM discovered_candidates
      WHERE organization_id = ${organizationId}::uuid AND sourcing_run_id = ${runId}::uuid
      ORDER BY created_at, id
    `;
    return {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      run: runs[0],
      attempts,
      candidates,
    };
  }

  async auditRun(runId: string) {
    const exported = await this.exportRun(runId);
    const run = exported.run as Record<string, unknown>;
    let missingProvenanceCount = 0;
    let missingEvidenceReferenceCount = 0;
    for (const candidate of exported.candidates) {
      const provenance = record(candidate.source_provenance);
      if (!provenance.providerKey || !provenance.sourceType || !provenance.observedAt || !provenance.retrievedAt) {
        missingProvenanceCount += 1;
      }
      const references = Array.isArray(provenance.evidenceReferences)
        ? provenance.evidenceReferences.filter((item) => typeof item === "string" && item.trim())
        : [];
      if (references.length === 0) missingEvidenceReferenceCount += 1;
    }
    const providerKeys = [...new Set(exported.attempts.map((attempt) => String(attempt.provider_key)).filter(Boolean))];
    return {
      runId,
      sourcePolicyVersion: String(run.source_policy_version ?? "unknown"),
      attemptCount: Number(run.attempt_count ?? exported.attempts.length),
      resultCount: Number(run.result_count ?? exported.candidates.length),
      provenanceComplete: missingProvenanceCount === 0 && missingEvidenceReferenceCount === 0,
      missingProvenanceCount,
      missingEvidenceReferenceCount,
      providerKeys,
      attempts: exported.attempts,
    };
  }
}
