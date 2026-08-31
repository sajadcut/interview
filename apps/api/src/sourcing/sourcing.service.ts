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
