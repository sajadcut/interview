import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { calculateEvidenceBackedScore, type CriterionScoreInput } from "./score-engine";
import type {
  CreateCriterionEvaluationDto,
  CreateEvidenceDto,
  CreateJobDto,
  MoveApplicationStageDto,
  SaveRubricDraftDto,
  SubmitHiringDecisionDto,
  UpdateJobDto,
  UpsertShortlistDto,
} from "./recruiting-operations.dto";

function actorId(auth: AuthContextService): string {
  const userId = auth.getOptional()?.userId;
  if (!userId) throw new BadRequestException("Authenticated user context is required");
  return userId;
}

function assertUniqueCriterionKeys(criteria: { criterionKey: string }[]): void {
  if (criteria.length === 0) throw new BadRequestException("At least one rubric criterion is required");
  const keys = criteria.map((criterion) => criterion.criterionKey.trim().toLowerCase());
  if (new Set(keys).size !== keys.length) {
    throw new BadRequestException("Rubric criterion keys must be unique");
  }
}

@Injectable()
export class RecruitingOperationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
  ) {}

  async createJob(input: CreateJobDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    assertUniqueCriterionKeys(input.rubricCriteria);

    return this.database.sql.begin(async (tx) => {
      const jobs = await tx`
        INSERT INTO jobs (
          organization_id, title, status, department, location, seniority, summary, created_by_user_id
        ) VALUES (
          ${organizationId}::uuid,
          ${input.title.trim()},
          'draft',
          ${input.department?.trim() || null},
          ${input.location?.trim() || null},
          ${input.seniority?.trim() || null},
          ${input.summary?.trim() || null},
          ${userId}::uuid
        )
        RETURNING id::text, title, status
      `;
      const job = jobs[0];
      if (!job?.id) throw new BadRequestException("Job could not be created");
      const jobId = String(job.id);

      for (const requirement of input.requirements) {
        await tx`
          INSERT INTO job_requirements (
            organization_id, job_id, requirement_type, name, description, weight, minimum_years
          ) VALUES (
            ${organizationId}::uuid,
            ${jobId}::uuid,
            ${requirement.requirementType},
            ${requirement.name.trim()},
            ${requirement.description?.trim() || null},
            ${requirement.weight},
            ${requirement.minimumYears ?? null}
          )
        `;
      }

      const rubrics = await tx`
        INSERT INTO rubrics (organization_id, job_id, name, status)
        VALUES (${organizationId}::uuid, ${jobId}::uuid, ${input.rubricName.trim()}, 'draft')
        RETURNING id::text
      `;
      const rubricId = String(rubrics[0]?.id);
      const versions = await tx`
        INSERT INTO rubric_versions (organization_id, rubric_id, version, status)
        VALUES (${organizationId}::uuid, ${rubricId}::uuid, 1, 'draft')
        RETURNING id::text
      `;
      const rubricVersionId = String(versions[0]?.id);

      for (const criterion of input.rubricCriteria) {
        await tx`
          INSERT INTO rubric_criteria (
            organization_id, rubric_version_id, criterion_key, label, description,
            weight, required, evidence_policy, display_order
          ) VALUES (
            ${organizationId}::uuid,
            ${rubricVersionId}::uuid,
            ${criterion.criterionKey.trim()},
            ${criterion.label.trim()},
            ${criterion.description?.trim() || null},
            ${criterion.weight},
            ${criterion.required},
            '{}'::jsonb,
            ${criterion.displayOrder}
          )
        `;
      }

      return {
        id: jobId,
        title: String(job.title),
        status: String(job.status),
        rubricId,
        rubricVersionId,
      };
    });
  }

  async updateJob(jobId: string, input: UpdateJobDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      UPDATE jobs
      SET title = COALESCE(${input.title?.trim() || null}, title),
          status = COALESCE(${input.status ?? null}, status),
          department = COALESCE(${input.department?.trim() || null}, department),
          location = COALESCE(${input.location?.trim() || null}, location),
          seniority = COALESCE(${input.seniority?.trim() || null}, seniority),
          summary = COALESCE(${input.summary?.trim() || null}, summary),
          updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${jobId}::uuid
      RETURNING id::text, title, status, department, location, seniority, summary, updated_at
    `;
    if (!rows[0]) throw new NotFoundException("Job not found");
    return rows[0];
  }

  async saveRubricDraft(jobId: string, input: SaveRubricDraftDto) {
    const organizationId = this.tenantContext.require().organizationId;
    assertUniqueCriterionKeys(input.criteria);

    return this.database.sql.begin(async (tx) => {
      const jobs = await tx`
        SELECT id::text FROM jobs
        WHERE organization_id = ${organizationId}::uuid AND id = ${jobId}::uuid
        LIMIT 1
      `;
      if (!jobs[0]) throw new NotFoundException("Job not found");

      const rubrics = await tx`
        SELECT id::text
        FROM rubrics
        WHERE organization_id = ${organizationId}::uuid AND job_id = ${jobId}::uuid
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE
      `;
      let rubricId = rubrics[0]?.id ? String(rubrics[0].id) : undefined;
      if (!rubricId) {
        const created = await tx`
          INSERT INTO rubrics (organization_id, job_id, name, status)
          VALUES (${organizationId}::uuid, ${jobId}::uuid, ${input.name.trim()}, 'draft')
          RETURNING id::text
        `;
        rubricId = String(created[0]?.id);
      } else {
        await tx`
          UPDATE rubrics SET name = ${input.name.trim()}, status = 'draft', updated_at = now()
          WHERE organization_id = ${organizationId}::uuid AND id = ${rubricId}::uuid
        `;
      }

      const drafts = await tx`
        SELECT id::text, version
        FROM rubric_versions
        WHERE organization_id = ${organizationId}::uuid
          AND rubric_id = ${rubricId}::uuid
          AND status = 'draft'
        ORDER BY version DESC
        LIMIT 1
        FOR UPDATE
      `;
      let rubricVersionId: string;
      let version: number;
      if (drafts[0]?.id) {
        rubricVersionId = String(drafts[0].id);
        version = Number(drafts[0].version);
        await tx`
          DELETE FROM rubric_criteria
          WHERE organization_id = ${organizationId}::uuid
            AND rubric_version_id = ${rubricVersionId}::uuid
        `;
      } else {
        const versions = await tx`
          SELECT COALESCE(max(version), 0)::int AS max_version
          FROM rubric_versions
          WHERE organization_id = ${organizationId}::uuid AND rubric_id = ${rubricId}::uuid
        `;
        version = Number(versions[0]?.max_version ?? 0) + 1;
        const createdVersion = await tx`
          INSERT INTO rubric_versions (organization_id, rubric_id, version, status)
          VALUES (${organizationId}::uuid, ${rubricId}::uuid, ${version}, 'draft')
          RETURNING id::text
        `;
        rubricVersionId = String(createdVersion[0]?.id);
      }

      for (const criterion of input.criteria) {
        await tx`
          INSERT INTO rubric_criteria (
            organization_id, rubric_version_id, criterion_key, label, description,
            weight, required, evidence_policy, display_order
          ) VALUES (
            ${organizationId}::uuid,
            ${rubricVersionId}::uuid,
            ${criterion.criterionKey.trim()},
            ${criterion.label.trim()},
            ${criterion.description?.trim() || null},
            ${criterion.weight},
            ${criterion.required},
            '{}'::jsonb,
            ${criterion.displayOrder}
          )
        `;
      }

      return { rubricId, rubricVersionId, version, status: "draft" as const };
    });
  }

  async publishRubric(jobId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    return this.database.sql.begin(async (tx) => {
      const versions = await tx`
        SELECT rv.id::text, rv.version, r.id::text AS rubric_id
        FROM rubrics r
        JOIN rubric_versions rv
          ON rv.organization_id = r.organization_id AND rv.rubric_id = r.id
        WHERE r.organization_id = ${organizationId}::uuid
          AND r.job_id = ${jobId}::uuid
          AND rv.status = 'draft'
        ORDER BY rv.version DESC
        LIMIT 1
        FOR UPDATE OF rv
      `;
      const version = versions[0];
      if (!version?.id) throw new NotFoundException("No draft rubric exists for this job");
      const criterionCount = await tx`
        SELECT count(*)::int AS count
        FROM rubric_criteria
        WHERE organization_id = ${organizationId}::uuid
          AND rubric_version_id = ${String(version.id)}::uuid
      `;
      if (Number(criterionCount[0]?.count ?? 0) === 0) {
        throw new BadRequestException("A rubric must contain at least one criterion before publication");
      }
      await tx`
        UPDATE rubric_versions
        SET status = 'published', published_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${String(version.id)}::uuid
      `;
      await tx`
        UPDATE rubrics
        SET status = 'published', updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${String(version.rubric_id)}::uuid
      `;
      return {
        rubricId: String(version.rubric_id),
        rubricVersionId: String(version.id),
        version: Number(version.version),
        status: "published" as const,
      };
    });
  }

  async moveApplicationStage(applicationId: string, input: MoveApplicationStageDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    return this.database.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT pipeline_stage
        FROM applications
        WHERE organization_id = ${organizationId}::uuid AND id = ${applicationId}::uuid
        LIMIT 1
        FOR UPDATE
      `;
      if (!rows[0]) throw new NotFoundException("Application not found");
      const fromStage = String(rows[0].pipeline_stage);
      const toStage = input.stage.trim();
      if (fromStage === toStage) throw new BadRequestException("Application is already in this stage");

      await tx`
        UPDATE applications
        SET pipeline_stage = ${toStage}, updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${applicationId}::uuid
      `;
      await tx`
        INSERT INTO application_stage_transitions (
          organization_id, application_id, from_stage, to_stage, reason, actor_user_id
        ) VALUES (
          ${organizationId}::uuid,
          ${applicationId}::uuid,
          ${fromStage},
          ${toStage},
          ${input.reason.trim()},
          ${userId}::uuid
        )
      `;
      return { applicationId, fromStage, toStage, reason: input.reason.trim() };
    });
  }

  async createEvidence(applicationId: string, input: CreateEvidenceDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const applications = await this.database.sql`
      SELECT candidate_id::text
      FROM applications
      WHERE organization_id = ${organizationId}::uuid AND id = ${applicationId}::uuid
      LIMIT 1
    `;
    const candidateId = applications[0]?.candidate_id ? String(applications[0].candidate_id) : undefined;
    if (!candidateId) throw new NotFoundException("Application not found");

    const rows = await this.database.sql`
      INSERT INTO evidence (
        organization_id, candidate_id, application_id, evidence_type, source_type,
        source_reference, excerpt, occurred_at, metadata
      ) VALUES (
        ${organizationId}::uuid,
        ${candidateId}::uuid,
        ${applicationId}::uuid,
        ${input.evidenceType.trim()},
        ${input.sourceType.trim()},
        ${input.sourceReference.trim()},
        ${input.excerpt?.trim() || null},
        ${input.occurredAt ? new Date(input.occurredAt) : null},
        '{}'::jsonb
      )
      RETURNING id::text, evidence_type, source_type, source_reference, excerpt, occurred_at, created_at
    `;
    return rows[0];
  }

  async createCriterionEvaluation(applicationId: string, input: CreateCriterionEvaluationDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const context = await this.database.sql`
      SELECT rc.rubric_version_id::text
      FROM applications a
      JOIN rubrics r
        ON r.organization_id = a.organization_id AND r.job_id = a.job_id
      JOIN rubric_versions rv
        ON rv.organization_id = r.organization_id AND rv.rubric_id = r.id
      JOIN rubric_criteria rc
        ON rc.organization_id = rv.organization_id AND rc.rubric_version_id = rv.id
      WHERE a.organization_id = ${organizationId}::uuid
        AND a.id = ${applicationId}::uuid
        AND rc.id = ${input.criterionId}::uuid
      ORDER BY rv.version DESC
      LIMIT 1
    `;
    const rubricVersionId = context[0]?.rubric_version_id
      ? String(context[0].rubric_version_id)
      : undefined;
    if (!rubricVersionId) throw new BadRequestException("Criterion does not belong to the application job rubric");
    if (input.evidenceIds.length === 0) {
      throw new BadRequestException("Criterion evaluations require at least one evidence item");
    }
    for (const evidenceId of new Set(input.evidenceIds)) {
      const evidence = await this.database.sql`
        SELECT 1
        FROM evidence
        WHERE organization_id = ${organizationId}::uuid
          AND application_id = ${applicationId}::uuid
          AND id = ${evidenceId}::uuid
        LIMIT 1
      `;
      if (!evidence[0]) throw new BadRequestException(`Evidence ${evidenceId} does not belong to this application`);
    }

    const rows = await this.database.sql`
      INSERT INTO candidate_criterion_evaluations (
        organization_id, application_id, rubric_version_id, criterion_id,
        evaluator_type, evaluator_version, score, confidence, rationale, evidence_ids, review_state
      ) VALUES (
        ${organizationId}::uuid,
        ${applicationId}::uuid,
        ${rubricVersionId}::uuid,
        ${input.criterionId}::uuid,
        'human',
        'human-v1',
        ${input.score},
        ${input.confidence ?? null},
        ${input.rationale.trim()},
        ${input.evidenceIds},
        ${input.reviewState ?? "reviewed"}
      )
      RETURNING id::text, criterion_id::text, score, confidence, rationale, evidence_ids, review_state, created_at
    `;
    return rows[0];
  }

  async finalizeScorecard(applicationId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rubricVersions = await this.database.sql`
      SELECT rv.id::text
      FROM applications a
      JOIN rubrics r
        ON r.organization_id = a.organization_id AND r.job_id = a.job_id
      JOIN rubric_versions rv
        ON rv.organization_id = r.organization_id AND rv.rubric_id = r.id
      WHERE a.organization_id = ${organizationId}::uuid
        AND a.id = ${applicationId}::uuid
      ORDER BY CASE WHEN rv.status = 'published' THEN 0 ELSE 1 END, rv.version DESC
      LIMIT 1
    `;
    const rubricVersionId = rubricVersions[0]?.id ? String(rubricVersions[0].id) : undefined;
    if (!rubricVersionId) throw new NotFoundException("Application rubric not found");

    const rows = await this.database.sql`
      SELECT
        rc.id::text AS criterion_id,
        rc.weight,
        latest.score,
        latest.evidence_ids
      FROM rubric_criteria rc
      LEFT JOIN LATERAL (
        SELECT e.score, e.evidence_ids
        FROM candidate_criterion_evaluations e
        WHERE e.organization_id = rc.organization_id
          AND e.application_id = ${applicationId}::uuid
          AND e.rubric_version_id = rc.rubric_version_id
          AND e.criterion_id = rc.id
        ORDER BY e.created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE rc.organization_id = ${organizationId}::uuid
        AND rc.rubric_version_id = ${rubricVersionId}::uuid
        AND rc.required = true
      ORDER BY rc.display_order, rc.criterion_key
    `;
    if (rows.length === 0) throw new BadRequestException("Rubric contains no required criteria");

    const missingEvaluationCriterionIds = rows
      .filter((row) => row.score === null || row.score === undefined)
      .map((row) => String(row.criterion_id));
    if (missingEvaluationCriterionIds.length > 0) {
      return {
        persisted: false,
        status: "incomplete" as const,
        recommendation: "insufficient_evidence" as const,
        overallScore: null,
        missingEvaluationCriterionIds,
        missingEvidenceCriterionIds: [],
        algorithmVersion: "weighted-evidence-v1" as const,
      };
    }

    const criteria: CriterionScoreInput[] = rows.map((row) => ({
      criterionId: String(row.criterion_id),
      weight: Number(row.weight),
      score: Number(row.score),
      evidenceIds: Array.isArray(row.evidence_ids) ? row.evidence_ids.map(String) : [],
    }));
    const score = calculateEvidenceBackedScore(criteria);
    if (score.status === "incomplete") return { persisted: false, ...score };

    const scorecards = await this.database.sql`
      INSERT INTO scorecards (
        organization_id, application_id, rubric_version_id, overall_score,
        recommendation, algorithm_version, review_state
      ) VALUES (
        ${organizationId}::uuid,
        ${applicationId}::uuid,
        ${rubricVersionId}::uuid,
        ${score.overallScore},
        ${score.recommendation},
        ${score.algorithmVersion},
        'pending'
      )
      RETURNING id::text, created_at
    `;
    return {
      persisted: true,
      scorecardId: String(scorecards[0]?.id),
      createdAt: new Date(String(scorecards[0]?.created_at)).toISOString(),
      ...score,
    };
  }

  async upsertShortlist(jobId: string, input: UpsertShortlistDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    const name = input.name?.trim() || "Primary shortlist";

    return this.database.sql.begin(async (tx) => {
      const jobs = await tx`
        SELECT 1 FROM jobs
        WHERE organization_id = ${organizationId}::uuid AND id = ${jobId}::uuid
        LIMIT 1
      `;
      if (!jobs[0]) throw new NotFoundException("Job not found");
      for (const entry of input.entries) {
        const applications = await tx`
          SELECT 1 FROM applications
          WHERE organization_id = ${organizationId}::uuid
            AND id = ${entry.applicationId}::uuid
            AND job_id = ${jobId}::uuid
          LIMIT 1
        `;
        if (!applications[0]) {
          throw new BadRequestException(`Application ${entry.applicationId} does not belong to this job`);
        }
      }

      const shortlistRows = await tx`
        INSERT INTO shortlists (
          organization_id, job_id, name, status, created_by_user_id
        ) VALUES (
          ${organizationId}::uuid,
          ${jobId}::uuid,
          ${name},
          ${input.status ?? "draft"},
          ${userId}::uuid
        )
        ON CONFLICT (organization_id, job_id, name) DO UPDATE
        SET status = EXCLUDED.status, updated_at = now()
        RETURNING id::text, status
      `;
      const shortlistId = String(shortlistRows[0]?.id);
      await tx`
        DELETE FROM shortlist_entries
        WHERE organization_id = ${organizationId}::uuid AND shortlist_id = ${shortlistId}::uuid
      `;
      for (const entry of input.entries) {
        await tx`
          INSERT INTO shortlist_entries (
            organization_id, shortlist_id, application_id, rank, rationale, added_by_user_id
          ) VALUES (
            ${organizationId}::uuid,
            ${shortlistId}::uuid,
            ${entry.applicationId}::uuid,
            ${entry.rank ?? null},
            ${entry.rationale?.trim() || null},
            ${userId}::uuid
          )
        `;
      }
      return {
        shortlistId,
        jobId,
        name,
        status: String(shortlistRows[0]?.status),
        entryCount: input.entries.length,
      };
    });
  }

  async submitHiringDecision(applicationId: string, input: SubmitHiringDecisionDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = actorId(this.authContext);
    return this.database.sql.begin(async (tx) => {
      const applications = await tx`
        SELECT id::text
        FROM applications
        WHERE organization_id = ${organizationId}::uuid AND id = ${applicationId}::uuid
        LIMIT 1
        FOR UPDATE
      `;
      if (!applications[0]) throw new NotFoundException("Application not found");
      if (input.scorecardId) {
        const scorecards = await tx`
          SELECT 1 FROM scorecards
          WHERE organization_id = ${organizationId}::uuid
            AND id = ${input.scorecardId}::uuid
            AND application_id = ${applicationId}::uuid
          LIMIT 1
        `;
        if (!scorecards[0]) throw new BadRequestException("Scorecard does not belong to this application");
      }

      const decisions = await tx`
        INSERT INTO hiring_decisions (
          organization_id, application_id, decision, reason, actor_user_id, scorecard_id, metadata
        ) VALUES (
          ${organizationId}::uuid,
          ${applicationId}::uuid,
          ${input.decision},
          ${input.reason.trim()},
          ${userId}::uuid,
          ${input.scorecardId ?? null}::uuid,
          '{}'::jsonb
        )
        RETURNING id::text, decision, reason, created_at
      `;

      if (["reject", "hire", "withdraw"].includes(input.decision)) {
        const terminalStage =
          input.decision === "hire" ? "hired" : input.decision === "reject" ? "rejected" : "withdrawn";
        await tx`
          UPDATE applications
          SET status = ${input.decision === "withdraw" ? "withdrawn" : "closed"},
              pipeline_stage = ${terminalStage},
              updated_at = now()
          WHERE organization_id = ${organizationId}::uuid AND id = ${applicationId}::uuid
        `;
      }

      return {
        id: String(decisions[0]?.id),
        applicationId,
        decision: String(decisions[0]?.decision),
        reason: String(decisions[0]?.reason),
        createdAt: new Date(String(decisions[0]?.created_at)).toISOString(),
      };
    });
  }

  async getDecisionSupport(applicationId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const applications = await this.database.sql`
      SELECT a.id::text, a.job_id::text, a.candidate_id::text, a.status, a.pipeline_stage,
             a.pre_interview_match_score, j.title AS job_title, c.display_name AS candidate_name
      FROM applications a
      JOIN jobs j ON j.organization_id = a.organization_id AND j.id = a.job_id
      JOIN candidates c ON c.organization_id = a.organization_id AND c.id = a.candidate_id
      WHERE a.organization_id = ${organizationId}::uuid AND a.id = ${applicationId}::uuid
      LIMIT 1
    `;
    if (!applications[0]) throw new NotFoundException("Application not found");
    const transitions = await this.database.sql`
      SELECT id::text, from_stage, to_stage, reason, actor_user_id::text, created_at
      FROM application_stage_transitions
      WHERE organization_id = ${organizationId}::uuid AND application_id = ${applicationId}::uuid
      ORDER BY created_at DESC
    `;
    const scorecards = await this.database.sql`
      SELECT id::text, overall_score, recommendation, algorithm_version, review_state, created_at
      FROM scorecards
      WHERE organization_id = ${organizationId}::uuid AND application_id = ${applicationId}::uuid
      ORDER BY created_at DESC
    `;
    const decisions = await this.database.sql`
      SELECT id::text, decision, reason, actor_user_id::text, scorecard_id::text, created_at
      FROM hiring_decisions
      WHERE organization_id = ${organizationId}::uuid AND application_id = ${applicationId}::uuid
      ORDER BY created_at DESC
    `;
    const evidence = await this.database.sql`
      SELECT id::text, evidence_type, source_type, source_reference, excerpt, occurred_at, created_at
      FROM evidence
      WHERE organization_id = ${organizationId}::uuid AND application_id = ${applicationId}::uuid
      ORDER BY created_at DESC
    `;
    return { application: applications[0], transitions, scorecards, decisions, evidence };
  }
}
