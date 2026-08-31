import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getSummary(jobId?: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const stageRows = jobId
      ? await this.database.sql`
          SELECT pipeline_stage, count(*)::int AS count
          FROM applications
          WHERE organization_id = ${organizationId}::uuid AND job_id = ${jobId}::uuid
          GROUP BY pipeline_stage
          ORDER BY count DESC, pipeline_stage
        `
      : await this.database.sql`
          SELECT pipeline_stage, count(*)::int AS count
          FROM applications
          WHERE organization_id = ${organizationId}::uuid
          GROUP BY pipeline_stage
          ORDER BY count DESC, pipeline_stage
        `;

    const totals = jobId
      ? await this.database.sql`
          SELECT
            count(DISTINCT a.id)::int AS applications,
            count(DISTINCT s.id) FILTER (WHERE s.status = 'completed')::int AS completed_interviews
          FROM applications a
          LEFT JOIN interview_sessions s
            ON s.organization_id = a.organization_id AND s.application_id = a.id
          WHERE a.organization_id = ${organizationId}::uuid AND a.job_id = ${jobId}::uuid
        `
      : await this.database.sql`
          SELECT
            count(DISTINCT a.id)::int AS applications,
            count(DISTINCT s.id) FILTER (WHERE s.status = 'completed')::int AS completed_interviews
          FROM applications a
          LEFT JOIN interview_sessions s
            ON s.organization_id = a.organization_id AND s.application_id = a.id
          WHERE a.organization_id = ${organizationId}::uuid
        `;

    const pendingReviews = jobId
      ? await this.database.sql`
          SELECT (
            SELECT count(*) FROM scorecards sc
            JOIN applications a ON a.organization_id = sc.organization_id AND a.id = sc.application_id
            WHERE sc.organization_id = ${organizationId}::uuid
              AND a.job_id = ${jobId}::uuid
              AND sc.review_state LIKE 'pending%'
          ) + (
            SELECT count(*) FROM screening_sessions ss
            JOIN applications a ON a.organization_id = ss.organization_id AND a.id = ss.application_id
            WHERE ss.organization_id = ${organizationId}::uuid
              AND a.job_id = ${jobId}::uuid
              AND ss.review_state LIKE 'pending%'
          ) AS count
        `
      : await this.database.sql`
          SELECT (
            SELECT count(*) FROM scorecards
            WHERE organization_id = ${organizationId}::uuid AND review_state LIKE 'pending%'
          ) + (
            SELECT count(*) FROM screening_sessions
            WHERE organization_id = ${organizationId}::uuid AND review_state LIKE 'pending%'
          ) AS count
        `;

    const sourceRows = jobId
      ? await this.database.sql`
          SELECT
            COALESCE(a.source, 'unknown') AS source,
            count(DISTINCT a.id)::int AS candidates,
            avg(a.pre_interview_match_score) AS average_match,
            count(DISTINCT a.id) FILTER (WHERE s.id IS NOT NULL)::int AS interviewed
          FROM applications a
          LEFT JOIN interview_sessions s
            ON s.organization_id = a.organization_id AND s.application_id = a.id
          WHERE a.organization_id = ${organizationId}::uuid AND a.job_id = ${jobId}::uuid
          GROUP BY COALESCE(a.source, 'unknown')
          ORDER BY candidates DESC, source
        `
      : await this.database.sql`
          SELECT
            COALESCE(a.source, 'unknown') AS source,
            count(DISTINCT a.id)::int AS candidates,
            avg(a.pre_interview_match_score) AS average_match,
            count(DISTINCT a.id) FILTER (WHERE s.id IS NOT NULL)::int AS interviewed
          FROM applications a
          LEFT JOIN interview_sessions s
            ON s.organization_id = a.organization_id AND s.application_id = a.id
          WHERE a.organization_id = ${organizationId}::uuid
          GROUP BY COALESCE(a.source, 'unknown')
          ORDER BY candidates DESC, source
        `;

    const totalApplications = Number(totals[0]?.applications ?? 0);
    return {
      funnel: {
        ...(jobId ? { jobId } : {}),
        totalApplications,
        stages: stageRows.map((row) => {
          const count = Number(row.count ?? 0);
          return {
            stage: String(row.pipeline_stage),
            count,
            shareOfApplications: totalApplications > 0 ? Math.round((count / totalApplications) * 10000) / 100 : 0,
          };
        }),
        completedInterviews: Number(totals[0]?.completed_interviews ?? 0),
        pendingHumanReviews: Number(pendingReviews[0]?.count ?? 0),
      },
      sources: sourceRows.map((row) => ({
        source: String(row.source),
        candidates: Number(row.candidates ?? 0),
        ...(row.average_match !== null ? { averagePreInterviewMatchScore: Math.round(Number(row.average_match) * 100) / 100 } : {}),
        interviewStageOrLater: Number(row.interviewed ?? 0),
      })),
      governanceNotice:
        "Analytics are operational decision support. Pre-interview match scores remain distinct from evidence-backed hiring scorecards and final decisions remain human-controlled.",
    };
  }
}
