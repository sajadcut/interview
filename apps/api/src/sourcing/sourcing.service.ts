import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import {
  ApprovedSourceTypes,
  type ApprovedSourceType,
  type CandidateSourceAdapter,
} from "./candidate-source.adapter";
import { CandidateSourceRegistry } from "./candidate-source.registry";
import { evaluateSourcePolicy } from "./source-policy";
import { candidateDiscoveryFingerprint } from "./sourcing-fingerprint";
import type { SourcingRetryRequestDto, SourcingRunRequestDto } from "./sourcing.dto";

const MAX_SOURCE_ATTEMPTS = 3;

@Injectable()
export class SourcingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
    private readonly sourceRegistry: CandidateSourceRegistry,
  ) {}

  listSourceCapabilities() {
    return this.sourceRegistry.capabilities();
  }

  async listTalentPool(limit = 100) {
    const organizationId = this.tenantContext.require().organizationId;
    const boundedLimit = Math.max(1, Math.min(250, Math.floor(limit)));
    const rows = await this.database.sql`
      SELECT
        t.candidate_id,
        t.status,
        t.tags,
        t.updated_at,
        c.display_name,
        c."current_role" AS "current_role",
        c.current_company,
        COALESCE(array_agg(DISTINCT cs.skill_label) FILTER (WHERE cs.skill_label IS NOT NULL), '{}') AS skills
      FROM talent_pool_entries t
      JOIN candidates c
        ON c.organization_id = t.organization_id AND c.id = t.candidate_id
      LEFT JOIN candidate_skills cs
        ON cs.organization_id = c.organization_id AND cs.candidate_id = c.id
      WHERE t.organization_id = ${organizationId}::uuid
      GROUP BY t.candidate_id, t.status, t.tags, t.updated_at, c.display_name, c."current_role", c.current_company
      ORDER BY t.updated_at DESC
      LIMIT ${boundedLimit}
    `;

    return rows.map((row) => ({
      candidateId: String(row.candidate_id),
      displayName: String(row.display_name),
      ...(row.current_role ? { currentRole: String(row.current_role) } : {}),
      ...(row.current_company ? { currentCompany: String(row.current_company) } : {}),
      skills: Array.isArray(row.skills) ? row.skills.map(String) : [],
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      status: String(row.status),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    }));
  }

  async listRuns(jobId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT id, job_id, status, requested_source_type, attempt_count,
             result_count, error_message, created_at
      FROM sourcing_runs
      WHERE organization_id = ${organizationId}::uuid AND job_id = ${jobId}::uuid
      ORDER BY created_at DESC
    `;
    return rows.map((row) => ({
      id: String(row.id),
      jobId: String(row.job_id),
      status: String(row.status),
      requestedSourceType: String(row.requested_source_type) as ApprovedSourceType,
      attemptCount: Number(row.attempt_count ?? 0),
      resultCount: Number(row.result_count ?? 0),
      ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
  }

  async getRun(runId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const runs = await this.database.sql`
      SELECT id, job_id, status, strategy, requested_source_type, source_policy_version,
             idempotency_key, attempt_count, result_count, error_message, created_at
      FROM sourcing_runs
      WHERE organization_id = ${organizationId}::uuid AND id = ${runId}::uuid
      LIMIT 1
    `;
    if (!runs.length) return null;
    const results = await this.database.sql`
      SELECT id, candidate_id, source_type, profile_snapshot, retrieval_score,
             pre_interview_match_score, dedupe_state, review_state,
             source_provenance, source_observed_at
      FROM discovered_candidates
      WHERE organization_id = ${organizationId}::uuid AND sourcing_run_id = ${runId}::uuid
      ORDER BY retrieval_score DESC NULLS LAST, created_at
    `;
    const attempts = await this.database.sql`
      SELECT attempt_no, source_type, provider_key, state, result_count, error_message,
             started_at, completed_at
      FROM sourcing_source_attempts
      WHERE organization_id = ${organizationId}::uuid AND sourcing_run_id = ${runId}::uuid
      ORDER BY attempt_no ASC
    `;
    const run = runs[0];
    return {
      id: String(run?.id),
      jobId: String(run?.job_id),
      status: String(run?.status),
      requestedSourceType: String(run?.requested_source_type) as ApprovedSourceType,
      sourcePolicyVersion: String(run?.source_policy_version),
      attemptCount: Number(run?.attempt_count ?? 0),
      resultCount: Number(run?.result_count ?? 0),
      ...(run?.error_message ? { errorMessage: String(run.error_message) } : {}),
      ...(run?.idempotency_key ? { idempotencyKey: String(run.idempotency_key) } : {}),
      strategy: (run?.strategy ?? {}) as Record<string, unknown>,
      createdAt: new Date(String(run?.created_at)).toISOString(),
      results: results.map((row) => ({
        id: String(row.id),
        ...(row.candidate_id ? { candidateId: String(row.candidate_id) } : {}),
        sourceType: String(row.source_type) as ApprovedSourceType,
        profileSnapshot: (row.profile_snapshot ?? {}) as Record<string, unknown>,
        sourceProvenance: (row.source_provenance ?? {}) as Record<string, unknown>,
        ...(row.source_observed_at
          ? { sourceObservedAt: new Date(String(row.source_observed_at)).toISOString() }
          : {}),
        ...(row.retrieval_score !== null ? { retrievalScore: Number(row.retrieval_score) } : {}),
        ...(row.pre_interview_match_score !== null
          ? { preInterviewMatchScore: Number(row.pre_interview_match_score) }
          : {}),
        dedupeState: String(row.dedupe_state),
        reviewState: String(row.review_state),
      })),
      attempts: attempts.map((attempt) => ({
        attemptNo: Number(attempt.attempt_no),
        sourceType: String(attempt.source_type) as ApprovedSourceType,
        providerKey: String(attempt.provider_key),
        state: String(attempt.state),
        resultCount: Number(attempt.result_count ?? 0),
        ...(attempt.error_message ? { errorMessage: String(attempt.error_message) } : {}),
        startedAt: new Date(String(attempt.started_at)).toISOString(),
        ...(attempt.completed_at
          ? { completedAt: new Date(String(attempt.completed_at)).toISOString() }
          : {}),
      })),
      retrievalNotice: "Retrieval score is a search signal and is not the final candidate match or hiring score.",
    };
  }

  async runSource(jobId: string, input: SourcingRunRequestDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const sourceType = input.sourceType ?? ApprovedSourceTypes.InternalTalentPool;
    const adapter = this.sourceRegistry.get(sourceType);
    const actorUserId = this.authContext.getOptional()?.userId;
    const query = input.query.trim();
    if (!query) throw new BadRequestException("A sourcing query is required");
    const policy = evaluateSourcePolicy({
      sourceType,
      requestedLimit: input.limit ?? 25,
      adapter,
      approvalConfirmed: input.approvalConfirmed,
      approverUserId: actorUserId,
    });
    const idempotencyKey = input.idempotencyKey?.trim() || undefined;

    if (idempotencyKey) {
      const existing = await this.database.sql`
        SELECT id::text
        FROM sourcing_runs
        WHERE organization_id = ${organizationId}::uuid
          AND job_id = ${jobId}::uuid
          AND idempotency_key = ${idempotencyKey}
        LIMIT 1
      `;
      if (existing[0]?.id) {
        const replay = await this.getRun(String(existing[0].id));
        return replay ? { ...replay, idempotentReplay: true } : replay;
      }
    }

    const strategy = {
      sourceType,
      providerKey: adapter.providerKey,
      query,
      limit: policy.limit,
      retrievalOnly: true,
      sourcePolicyVersion: policy.policyVersion,
      note: "Retrieval score is not the final candidate match or hiring score",
    };

    const runRows = idempotencyKey
      ? await this.database.sql`
          INSERT INTO sourcing_runs (
            organization_id, job_id, status, strategy, approved_by_user_id,
            requested_by_user_id, requested_source_type, source_policy_version, idempotency_key
          ) VALUES (
            ${organizationId}::uuid,
            ${jobId}::uuid,
            'pending',
            ${this.database.sql.json(strategy as never)},
            ${policy.approvedByUserId ?? null}::uuid,
            ${actorUserId ?? null}::uuid,
            ${sourceType},
            ${policy.policyVersion},
            ${idempotencyKey}
          )
          ON CONFLICT (organization_id, job_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
          DO NOTHING
          RETURNING id::text
        `
      : await this.database.sql`
          INSERT INTO sourcing_runs (
            organization_id, job_id, status, strategy, approved_by_user_id,
            requested_by_user_id, requested_source_type, source_policy_version
          ) VALUES (
            ${organizationId}::uuid,
            ${jobId}::uuid,
            'pending',
            ${this.database.sql.json(strategy as never)},
            ${policy.approvedByUserId ?? null}::uuid,
            ${actorUserId ?? null}::uuid,
            ${sourceType},
            ${policy.policyVersion}
          )
          RETURNING id::text
        `;

    if (!runRows[0]?.id && idempotencyKey) {
      const existing = await this.database.sql`
        SELECT id::text
        FROM sourcing_runs
        WHERE organization_id = ${organizationId}::uuid
          AND job_id = ${jobId}::uuid
          AND idempotency_key = ${idempotencyKey}
        LIMIT 1
      `;
      if (existing[0]?.id) {
        const replay = await this.getRun(String(existing[0].id));
        return replay ? { ...replay, idempotentReplay: true } : replay;
      }
    }

    const runId = String(runRows[0]?.id);
    if (!runId) throw new Error("Unable to create sourcing run");
    return this.executeRun({
      organizationId,
      runId,
      jobId,
      query,
      limit: policy.limit,
      adapter,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }

  async retryRun(runId: string, input: SourcingRetryRequestDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT job_id::text, status, requested_source_type, strategy, attempt_count, idempotency_key
      FROM sourcing_runs
      WHERE organization_id = ${organizationId}::uuid AND id = ${runId}::uuid
      LIMIT 1
    `;
    const run = rows[0];
    if (!run) throw new NotFoundException("Sourcing run not found");
    if (String(run.status) !== "failed") {
      throw new BadRequestException("Only failed sourcing runs can be retried");
    }
    const attemptCount = Number(run.attempt_count ?? 0);
    if (attemptCount >= MAX_SOURCE_ATTEMPTS) {
      throw new BadRequestException(`Sourcing run reached the maximum of ${MAX_SOURCE_ATTEMPTS} attempts`);
    }

    const sourceType = String(run.requested_source_type) as ApprovedSourceType;
    const adapter = this.sourceRegistry.get(sourceType);
    const actorUserId = this.authContext.getOptional()?.userId;
    const policy = evaluateSourcePolicy({
      sourceType,
      requestedLimit: Number((run.strategy as Record<string, unknown> | undefined)?.limit ?? 25),
      adapter,
      approvalConfirmed: input.approvalConfirmed,
      approverUserId: actorUserId,
    });
    const strategy = (run.strategy ?? {}) as Record<string, unknown>;
    const query = typeof strategy.query === "string" ? strategy.query.trim() : "";
    if (!query) throw new BadRequestException("Stored sourcing run has no retryable query");

    if (policy.approvedByUserId) {
      await this.database.sql`
        UPDATE sourcing_runs
        SET approved_by_user_id = ${policy.approvedByUserId}::uuid
        WHERE organization_id = ${organizationId}::uuid AND id = ${runId}::uuid
      `;
    }

    return this.executeRun({
      organizationId,
      runId,
      jobId: String(run.job_id),
      query,
      limit: policy.limit,
      adapter,
      ...(run.idempotency_key ? { idempotencyKey: String(run.idempotency_key) } : {}),
    });
  }

  async searchInternalTalent(jobId: string, query: string, limit = 25) {
    return this.runSource(jobId, {
      query,
      limit,
      sourceType: ApprovedSourceTypes.InternalTalentPool,
    });
  }

  private async executeRun(input: {
    organizationId: string;
    runId: string;
    jobId: string;
    query: string;
    limit: number;
    adapter: CandidateSourceAdapter;
    idempotencyKey?: string;
  }) {
    const attemptRows = await this.database.sql`
      UPDATE sourcing_runs
      SET status = 'running',
          attempt_count = attempt_count + 1,
          started_at = COALESCE(started_at, now()),
          completed_at = NULL,
          error_message = NULL
      WHERE organization_id = ${input.organizationId}::uuid AND id = ${input.runId}::uuid
      RETURNING attempt_count
    `;
    const attemptNo = Number(attemptRows[0]?.attempt_count ?? 1);
    const sourceAttemptRows = await this.database.sql`
      INSERT INTO sourcing_source_attempts (
        organization_id, sourcing_run_id, source_type, provider_key,
        attempt_no, state, idempotency_key
      ) VALUES (
        ${input.organizationId}::uuid,
        ${input.runId}::uuid,
        ${input.adapter.sourceType},
        ${input.adapter.providerKey},
        ${attemptNo},
        'running',
        ${input.idempotencyKey ?? null}
      )
      RETURNING id::text
    `;
    const sourceAttemptId = String(sourceAttemptRows[0]?.id);

    try {
      const results = await input.adapter.search({
        organizationId: input.organizationId,
        jobId: input.jobId,
        query: input.query,
        limit: input.limit,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      });

      for (const result of results) {
        const fingerprint = candidateDiscoveryFingerprint(result);
        await this.database.sql`
          INSERT INTO discovered_candidates (
            organization_id,
            sourcing_run_id,
            candidate_id,
            source_type,
            source_external_key,
            normalized_identity,
            profile_snapshot,
            retrieval_score,
            dedupe_state,
            review_state,
            discovery_fingerprint,
            source_provenance,
            source_observed_at
          ) VALUES (
            ${input.organizationId}::uuid,
            ${input.runId}::uuid,
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
            ${new Date(result.provenance.observedAt)}
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

      const persisted = await this.database.sql`
        SELECT count(*)::int AS count
        FROM discovered_candidates
        WHERE organization_id = ${input.organizationId}::uuid
          AND sourcing_run_id = ${input.runId}::uuid
      `;
      const resultCount = Number(persisted[0]?.count ?? 0);
      await this.database.sql.begin(async (tx) => {
        await tx`
          UPDATE sourcing_source_attempts
          SET state = 'succeeded', result_count = ${resultCount}, completed_at = now()
          WHERE organization_id = ${input.organizationId}::uuid AND id = ${sourceAttemptId}::uuid
        `;
        await tx`
          UPDATE sourcing_runs
          SET status = 'succeeded', result_count = ${resultCount}, completed_at = now()
          WHERE organization_id = ${input.organizationId}::uuid AND id = ${input.runId}::uuid
        `;
      });

      const detail = await this.getRun(input.runId);
      return detail ? { ...detail, idempotentReplay: false, providerKey: input.adapter.providerKey } : detail;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sourcing failure";
      await this.database.sql.begin(async (tx) => {
        await tx`
          UPDATE sourcing_source_attempts
          SET state = 'failed', error_message = ${message.slice(0, 4000)}, completed_at = now()
          WHERE organization_id = ${input.organizationId}::uuid AND id = ${sourceAttemptId}::uuid
        `;
        await tx`
          UPDATE sourcing_runs
          SET status = 'failed', error_message = ${message.slice(0, 4000)}, completed_at = now()
          WHERE organization_id = ${input.organizationId}::uuid AND id = ${input.runId}::uuid
        `;
      });
      throw error;
    }
  }
}
