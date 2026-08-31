import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import {
  calculateEvidenceBackedScore,
  type CriterionScoreInput,
  type ScoreResult,
} from "./score-engine";

@Injectable()
export class RecruitingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getApplicationIntelligence(applicationId: string) {
    const organizationId = this.tenantContext.require().organizationId;

    const application = await this.database.sql`
      SELECT
        a.id,
        a.status,
        a.pipeline_stage,
        a.source,
        a.pre_interview_match_score,
        j.id AS job_id,
        j.title AS job_title,
        c.id AS candidate_id,
        c.display_name AS candidate_name,
        c.current_role,
        c.current_company
      FROM applications a
      JOIN jobs j
        ON j.organization_id = a.organization_id AND j.id = a.job_id
      JOIN candidates c
        ON c.organization_id = a.organization_id AND c.id = a.candidate_id
      WHERE a.organization_id = ${organizationId}::uuid
        AND a.id = ${applicationId}::uuid
      LIMIT 1
    `;

    if (!application.length) return null;

    const evidence = await this.database.sql`
      SELECT id, evidence_type, source_type, source_reference, excerpt, occurred_at, metadata, created_at
      FROM evidence
      WHERE organization_id = ${organizationId}::uuid
        AND application_id = ${applicationId}::uuid
      ORDER BY created_at DESC
    `;

    const evaluations = await this.database.sql`
      SELECT
        e.id,
        e.criterion_id,
        rc.criterion_key,
        rc.label,
        rc.weight,
        e.evaluator_type,
        e.evaluator_version,
        e.score,
        e.confidence,
        e.rationale,
        e.evidence_ids,
        e.review_state,
        e.created_at
      FROM candidate_criterion_evaluations e
      JOIN rubric_criteria rc
        ON rc.organization_id = e.organization_id AND rc.id = e.criterion_id
      WHERE e.organization_id = ${organizationId}::uuid
        AND e.application_id = ${applicationId}::uuid
      ORDER BY rc.display_order, e.created_at DESC
    `;

    const scorecards = await this.database.sql`
      SELECT id, rubric_version_id, overall_score, recommendation, algorithm_version, review_state, created_at
      FROM scorecards
      WHERE organization_id = ${organizationId}::uuid
        AND application_id = ${applicationId}::uuid
      ORDER BY created_at DESC
    `;

    return {
      application: application[0],
      evidence,
      evaluations,
      scorecards,
    };
  }

  previewScorecard(input: unknown): ScoreResult {
    if (!input || typeof input !== "object" || !("criteria" in input)) {
      throw new Error("criteria are required");
    }

    const rawCriteria = (input as { criteria?: unknown }).criteria;
    if (!Array.isArray(rawCriteria)) throw new Error("criteria must be an array");

    const criteria: CriterionScoreInput[] = rawCriteria.map((value, index) => {
      if (!value || typeof value !== "object") {
        throw new Error(`criterion ${index} must be an object`);
      }
      const candidate = value as Record<string, unknown>;
      if (typeof candidate.criterionId !== "string") throw new Error(`criterion ${index} requires criterionId`);
      if (typeof candidate.weight !== "number") throw new Error(`criterion ${index} requires numeric weight`);
      if (typeof candidate.score !== "number") throw new Error(`criterion ${index} requires numeric score`);
      if (!Array.isArray(candidate.evidenceIds) || !candidate.evidenceIds.every((id) => typeof id === "string")) {
        throw new Error(`criterion ${index} requires string evidenceIds`);
      }
      return {
        criterionId: candidate.criterionId,
        weight: candidate.weight,
        score: candidate.score,
        evidenceIds: candidate.evidenceIds,
      };
    });

    return calculateEvidenceBackedScore(criteria);
  }
}
