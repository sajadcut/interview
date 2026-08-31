import { Controller, Get, NotFoundException } from "@nestjs/common";
import { getEnv } from "./config/env";
import { DatabaseService } from "./database/database.service";

@Controller()
export class AppController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  getBootstrapStatus(): { service: string; status: string } {
    return {
      service: "interview-api",
      status: "bootstrap",
    };
  }

  @Get("development/context")
  async getDevelopmentContext() {
    if (getEnv().NODE_ENV === "production") throw new NotFoundException();

    const organizationSlug = process.env.DEV_ORGANIZATION_SLUG?.trim() || "local-interview";
    const userEmail = process.env.DEV_USER_EMAIL?.trim() || "admin@local.interview";
    const rows = await this.database.sql`
      SELECT
        o.id AS organization_id,
        u.id AS user_id,
        a.id AS application_id,
        p.id AS interview_plan_id,
        p.rubric_version_id,
        c.id AS consent_record_id
      FROM organizations o
      JOIN users u ON u.email = ${userEmail}
      JOIN memberships m
        ON m.organization_id = o.id AND m.user_id = u.id AND m.status = 'active'
      JOIN applications a ON a.organization_id = o.id
      JOIN candidates candidate
        ON candidate.organization_id = a.organization_id
       AND candidate.id = a.candidate_id
       AND candidate.primary_email = 'ali.rahimi@example.local'
      JOIN interview_plans p
        ON p.organization_id = a.organization_id
       AND p.job_id = a.job_id
       AND p.status = 'published'
      JOIN consent_records c
        ON c.organization_id = a.organization_id
       AND c.application_id = a.id
       AND c.purpose = 'ai_interview'
       AND c.withdrawn_at IS NULL
      WHERE o.slug = ${organizationSlug}
      ORDER BY p.version DESC, c.granted_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      return {
        ready: false,
        reason: "Development domain fixtures are not available. Run dev:bootstrap after migrations.",
      };
    }

    const criterionRows = await this.database.sql`
      SELECT id, criterion_key, label, display_order
      FROM rubric_criteria
      WHERE organization_id = ${String(row.organization_id)}::uuid
        AND rubric_version_id = ${String(row.rubric_version_id)}::uuid
        AND required = true
      ORDER BY display_order, criterion_key
    `;

    return {
      ready: true,
      organizationId: String(row.organization_id),
      userId: String(row.user_id),
      fixtures: {
        applicationId: String(row.application_id),
        interviewPlanId: String(row.interview_plan_id),
        consentRecordId: String(row.consent_record_id),
        criteria: criterionRows.map((criterion) => ({
          id: String(criterion.id),
          key: String(criterion.criterion_key),
          label: String(criterion.label),
        })),
      },
    };
  }
}
