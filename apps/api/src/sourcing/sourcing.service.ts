import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { InternalTalentPoolAdapter } from "./internal-talent-pool.adapter";

@Injectable()
export class SourcingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly internalTalentPool: InternalTalentPoolAdapter,
  ) {}

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
      SELECT id, job_id, status, result_count, error_message, created_at
      FROM sourcing_runs
      WHERE organization_id = ${organizationId}::uuid AND job_id = ${jobId}::uuid
      ORDER BY created_at DESC
    `;
    return rows.map((row) => ({
      id: String(row.id),
      jobId: String(row.job_id),
      status: String(row.status),
      resultCount: Number(row.result_count ?? 0),
      ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
  }

  async getRun(runId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const runs = await this.database.sql`
      SELECT id, job_id, status, strategy, result_count, error_message, created_at
      FROM sourcing_runs
      WHERE organization_id = ${organizationId}::uuid AND id = ${runId}::uuid
      LIMIT 1
    `;
    if (!runs.length) return null;
    const results = await this.database.sql`
      SELECT id, candidate_id, source_type, profile_snapshot, retrieval_score,
             pre_interview_match_score, dedupe_state, review_state
      FROM discovered_candidates
      WHERE organization_id = ${organizationId}::uuid AND sourcing_run_id = ${runId}::uuid
      ORDER BY retrieval_score DESC NULLS LAST, created_at
    `;
    const run = runs[0];
    return {
      id: String(run?.id),
      jobId: String(run?.job_id),
      status: String(run?.status),
      strategy: (run?.strategy ?? {}) as Record<string, unknown>,
      resultCount: Number(run?.result_count ?? 0),
      ...(run?.error_message ? { errorMessage: String(run.error_message) } : {}),
      createdAt: new Date(String(run?.created_at)).toISOString(),
      results: results.map((row) => ({
        id: String(row.id),
        ...(row.candidate_id ? { candidateId: String(row.candidate_id) } : {}),
        sourceType: String(row.source_type),
        profileSnapshot: (row.profile_snapshot ?? {}) as Record<string, unknown>,
        ...(row.retrieval_score !== null ? { retrievalScore: Number(row.retrieval_score) } : {}),
        ...(row.pre_interview_match_score !== null
          ? { preInterviewMatchScore: Number(row.pre_interview_match_score) }
          : {}),
        dedupeState: String(row.dedupe_state),
        reviewState: String(row.review_state),
      })),
      retrievalNotice: "Retrieval score is a search signal and is not the final candidate match or hiring score.",
    };
  }

  async searchInternalTalent(jobId: string, query: string, limit = 25) {
    const organizationId = this.tenantContext.require().organizationId;
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("A sourcing query is required");
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));

    const runRows = await this.database.sql`
      INSERT INTO sourcing_runs (organization_id, job_id, status, strategy, started_at)
      VALUES (
        ${organizationId}::uuid,
        ${jobId}::uuid,
        'running',
        ${this.database.sql.json({
          adapterOrder: ["internal_talent_pool"],
          query: normalizedQuery,
          retrievalOnly: true,
          note: "Retrieval score is not the final candidate match or hiring score",
        } as never)},
        now()
      )
      RETURNING id
    `;
    const runId = String(runRows[0]?.id);

    try {
      const results = await this.internalTalentPool.search({
        organizationId,
        jobId,
        query: normalizedQuery,
        limit: boundedLimit,
      });

      for (const result of results) {
        await this.database.sql`
          INSERT INTO discovered_candidates (
            organization_id,
            sourcing_run_id,
            candidate_id,
            source_type,
            profile_snapshot,
            retrieval_score,
            dedupe_state,
            review_state
          ) VALUES (
            ${organizationId}::uuid,
            ${runId}::uuid,
            ${result.candidateId ?? null}::uuid,
            ${result.sourceType},
            ${this.database.sql.json({
              displayName: result.displayName,
              currentRole: result.currentRole,
              currentCompany: result.currentCompany,
              skills: result.skills,
              evidenceSummary: result.evidenceSummary,
            } as never)},
            ${result.retrievalScore},
            'resolved_internal',
            'new'
          )
        `;
      }

      await this.database.sql`
        UPDATE sourcing_runs
        SET status = 'succeeded', result_count = ${results.length}, completed_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${runId}::uuid
      `;

      return {
        runId,
        adapter: this.internalTalentPool.sourceType,
        retrievalOnly: true,
        results,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sourcing failure";
      await this.database.sql`
        UPDATE sourcing_runs
        SET status = 'failed', error_message = ${message.slice(0, 4000)}, completed_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${runId}::uuid
      `;
      throw error;
    }
  }
}
