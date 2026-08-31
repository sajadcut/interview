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

  async listJobs() {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT
        j.id,
        j.title,
        j.status,
        j.department,
        j.location,
        j.seniority,
        j.updated_at,
        count(DISTINCT a.id)::int AS application_count,
        count(DISTINCT s.id)::int AS interview_count
      FROM jobs j
      LEFT JOIN applications a
        ON a.organization_id = j.organization_id AND a.job_id = j.id
      LEFT JOIN interview_sessions s
        ON s.organization_id = a.organization_id AND s.application_id = a.id
      WHERE j.organization_id = ${organizationId}::uuid
      GROUP BY j.id, j.title, j.status, j.department, j.location, j.seniority, j.updated_at
      ORDER BY j.updated_at DESC
    `;

    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: String(row.status),
      ...(row.department ? { department: String(row.department) } : {}),
      ...(row.location ? { location: String(row.location) } : {}),
      ...(row.seniority ? { seniority: String(row.seniority) } : {}),
      applicationCount: Number(row.application_count ?? 0),
      interviewCount: Number(row.interview_count ?? 0),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    }));
  }

  async getJobWorkspace(jobId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const jobs = await this.database.sql`
      SELECT id, title, status, department, location, seniority, summary
      FROM jobs
      WHERE organization_id = ${organizationId}::uuid AND id = ${jobId}::uuid
      LIMIT 1
    `;
    if (!jobs.length) return null;

    const requirements = await this.database.sql`
      SELECT id, requirement_type, name, description, weight, minimum_years
      FROM job_requirements
      WHERE organization_id = ${organizationId}::uuid AND job_id = ${jobId}::uuid
      ORDER BY CASE requirement_type WHEN 'must_have' THEN 0 ELSE 1 END, weight DESC, name
    `;

    const rubricCriteria = await this.database.sql`
      SELECT rc.id, rc.criterion_key, rc.label, rc.weight, rc.required, rc.display_order
      FROM rubrics r
      JOIN rubric_versions rv
        ON rv.organization_id = r.organization_id AND rv.rubric_id = r.id
      JOIN rubric_criteria rc
        ON rc.organization_id = rv.organization_id AND rc.rubric_version_id = rv.id
      WHERE r.organization_id = ${organizationId}::uuid
        AND r.job_id = ${jobId}::uuid
        AND rv.id = (
          SELECT rv2.id
          FROM rubric_versions rv2
          WHERE rv2.organization_id = r.organization_id AND rv2.rubric_id = r.id
          ORDER BY rv2.version DESC
          LIMIT 1
        )
      ORDER BY rc.display_order, rc.label
    `;

    const pipeline = await this.database.sql`
      SELECT pipeline_stage, count(*)::int AS count
      FROM applications
      WHERE organization_id = ${organizationId}::uuid AND job_id = ${jobId}::uuid
      GROUP BY pipeline_stage
      ORDER BY count DESC, pipeline_stage
    `;

    const job = jobs[0];
    return {
      id: String(job?.id),
      title: String(job?.title),
      status: String(job?.status),
      ...(job?.department ? { department: String(job.department) } : {}),
      ...(job?.location ? { location: String(job.location) } : {}),
      ...(job?.seniority ? { seniority: String(job.seniority) } : {}),
      ...(job?.summary ? { summary: String(job.summary) } : {}),
      requirements: requirements.map((row) => ({
        id: String(row.id),
        requirementType: String(row.requirement_type),
        name: String(row.name),
        ...(row.description ? { description: String(row.description) } : {}),
        weight: Number(row.weight),
        ...(row.minimum_years !== null ? { minimumYears: Number(row.minimum_years) } : {}),
      })),
      rubricCriteria: rubricCriteria.map((row) => ({
        id: String(row.id),
        criterionKey: String(row.criterion_key),
        label: String(row.label),
        weight: Number(row.weight),
        required: Boolean(row.required),
        displayOrder: Number(row.display_order),
      })),
      pipeline: pipeline.map((row) => ({ stage: String(row.pipeline_stage), count: Number(row.count) })),
    };
  }

  async listCandidates(jobId?: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = jobId
      ? await this.database.sql`
          SELECT
            c.id,
            c.display_name,
            c."current_role" AS current_role,
            c.current_company,
            c.location,
            c.updated_at,
            a.id AS application_id,
            a.pipeline_stage,
            a.pre_interview_match_score,
            COALESCE(array_agg(DISTINCT cs.skill_label) FILTER (WHERE cs.skill_label IS NOT NULL), '{}') AS skills
          FROM applications a
          JOIN candidates c
            ON c.organization_id = a.organization_id AND c.id = a.candidate_id
          LEFT JOIN candidate_skills cs
            ON cs.organization_id = c.organization_id AND cs.candidate_id = c.id
          WHERE a.organization_id = ${organizationId}::uuid AND a.job_id = ${jobId}::uuid
          GROUP BY c.id, c.display_name, c."current_role", c.current_company, c.location, c.updated_at,
                   a.id, a.pipeline_stage, a.pre_interview_match_score
          ORDER BY a.pre_interview_match_score DESC NULLS LAST, c.updated_at DESC
        `
      : await this.database.sql`
          SELECT
            c.id,
            c.display_name,
            c."current_role" AS current_role,
            c.current_company,
            c.location,
            c.updated_at,
            NULL::uuid AS application_id,
            NULL::varchar AS pipeline_stage,
            NULL::numeric AS pre_interview_match_score,
            COALESCE(array_agg(DISTINCT cs.skill_label) FILTER (WHERE cs.skill_label IS NOT NULL), '{}') AS skills
          FROM candidates c
          LEFT JOIN candidate_skills cs
            ON cs.organization_id = c.organization_id AND cs.candidate_id = c.id
          WHERE c.organization_id = ${organizationId}::uuid
          GROUP BY c.id, c.display_name, c."current_role", c.current_company, c.location, c.updated_at
          ORDER BY c.updated_at DESC
        `;

    return rows.map((row) => ({
      id: String(row.id),
      displayName: String(row.display_name),
      ...(row.current_role ? { currentRole: String(row.current_role) } : {}),
      ...(row.current_company ? { currentCompany: String(row.current_company) } : {}),
      ...(row.location ? { location: String(row.location) } : {}),
      ...(row.application_id ? { applicationId: String(row.application_id) } : {}),
      ...(row.pipeline_stage ? { pipelineStage: String(row.pipeline_stage) } : {}),
      ...(row.pre_interview_match_score !== null
        ? { preInterviewMatchScore: Number(row.pre_interview_match_score) }
        : {}),
      skills: Array.isArray(row.skills) ? row.skills.map(String) : [],
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    }));
  }

  async getCandidateWorkspace(candidateId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const candidates = await this.database.sql`
      SELECT id, display_name, primary_email, primary_phone, "current_role" AS current_role,
             current_company, location, preferred_language
      FROM candidates
      WHERE organization_id = ${organizationId}::uuid AND id = ${candidateId}::uuid
      LIMIT 1
    `;
    if (!candidates.length) return null;

    const skills = await this.database.sql`
      SELECT id, skill_key, skill_label, verification_state, confidence, source_reference
      FROM candidate_skills
      WHERE organization_id = ${organizationId}::uuid AND candidate_id = ${candidateId}::uuid
      ORDER BY verification_state, confidence DESC NULLS LAST, skill_label
    `;
    const applications = await this.database.sql`
      SELECT a.id, a.job_id, j.title AS job_title, a.status, a.pipeline_stage, a.source, a.pre_interview_match_score
      FROM applications a
      JOIN jobs j ON j.organization_id = a.organization_id AND j.id = a.job_id
      WHERE a.organization_id = ${organizationId}::uuid AND a.candidate_id = ${candidateId}::uuid
      ORDER BY a.updated_at DESC
    `;

    const candidate = candidates[0];
    return {
      id: String(candidate?.id),
      displayName: String(candidate?.display_name),
      ...(candidate?.primary_email ? { primaryEmail: String(candidate.primary_email) } : {}),
      ...(candidate?.primary_phone ? { primaryPhone: String(candidate.primary_phone) } : {}),
      ...(candidate?.current_role ? { currentRole: String(candidate.current_role) } : {}),
      ...(candidate?.current_company ? { currentCompany: String(candidate.current_company) } : {}),
      ...(candidate?.location ? { location: String(candidate.location) } : {}),
      ...(candidate?.preferred_language ? { preferredLanguage: String(candidate.preferred_language) } : {}),
      skills: skills.map((row) => ({
        id: String(row.id),
        skillKey: String(row.skill_key),
        skillLabel: String(row.skill_label),
        verificationState: String(row.verification_state),
        ...(row.confidence !== null ? { confidence: Number(row.confidence) } : {}),
        ...(row.source_reference ? { sourceReference: String(row.source_reference) } : {}),
      })),
      applications: applications.map((row) => ({
        id: String(row.id),
        jobId: String(row.job_id),
        jobTitle: String(row.job_title),
        status: String(row.status),
        pipelineStage: String(row.pipeline_stage),
        ...(row.source ? { source: String(row.source) } : {}),
        ...(row.pre_interview_match_score !== null
          ? { preInterviewMatchScore: Number(row.pre_interview_match_score) }
          : {}),
      })),
    };
  }

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
        c."current_role" AS current_role,
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
