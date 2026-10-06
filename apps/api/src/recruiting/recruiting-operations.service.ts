import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { calculateEvidenceBackedScore, type CriterionScoreInput } from "./score-engine";
import { canSubmitRequisitionBackedHire } from "./hiring-workflow-policy";
import type {
  CreateApplicationDto,
  CreateCandidateDto,
  CreateCriterionEvaluationDto,
  CreateEvidenceDto,
  CreateJobDto,
  MoveApplicationStageDto,
  SaveRubricDraftDto,
  SubmitHiringDecisionDto,
  UpdateCandidateDto,
  UpdateJobDto,
  UpsertShortlistDto,
} from "./recruiting-operations.dto";

function actorId(auth: AuthContextService): string {
  const userId = auth.getOptional()?.userId;
  if (!userId) throw new BadRequestException("Authenticated user context is required");
  return userId;
}

const SOFT_SKILL_PATTERN = /(communication|collaboration|teamwork|ownership|problem[_ -]?solving|ambiguity|stakeholder|leadership|decision[_ -]?making|trade[_ -]?off|reasoning|ارتباط|ذی.?نفع|همکاری|تیمی|مالکیت|مسئولیت|حل مسئله|ابهام|تصمیم|بده.?بستان|موازنه)/i;

function criterionEvidencePolicy(criterion: { criterionKey: string; label: string }) {
  const category = SOFT_SKILL_PATTERN.test(`${criterion.criterionKey} ${criterion.label}`)
    ? "soft_skill"
    : "technical";
  return {
    category,
    minimumEvidence: 1,
    evidenceSource: "candidate_interview_transcript",
    biometricInferenceAllowed: false,
  };
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
      if (input.hiringRequestId) {
        const requests = await tx`
          SELECT id::text, status, linked_job_id::text, hr_owner_user_id::text
          FROM hiring_requests
          WHERE organization_id = ${organizationId}::uuid
            AND id = ${input.hiringRequestId}::uuid
          LIMIT 1
          FOR UPDATE
        `;
        const hiringRequest = requests[0];
        if (!hiringRequest) throw new NotFoundException("Hiring request not found");
        if (hiringRequest.linked_job_id) {
          throw new BadRequestException("Hiring request is already linked to a job");
        }
        if (String(hiringRequest.status) !== "approved") {
          throw new BadRequestException("Hiring request must be approved before creating a linked job");
        }
        if (String(hiringRequest.hr_owner_user_id ?? "") !== userId) {
          throw new BadRequestException("Only the HR owner who approved the hiring request can create its linked job");
        }
      }

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
            ${tx.json(criterionEvidencePolicy(criterion) as never)},
            ${criterion.displayOrder}
          )
        `;
      }

      if (input.hiringRequestId) {
        const linked = await tx`
          UPDATE hiring_requests
          SET linked_job_id = ${jobId}::uuid,
              status = 'recruiting',
              updated_at = now()
          WHERE organization_id = ${organizationId}::uuid
            AND id = ${input.hiringRequestId}::uuid
            AND status = 'approved'
            AND linked_job_id IS NULL
          RETURNING id::text, status
        `;
        if (!linked[0]) {
          throw new BadRequestException("Hiring request could not be linked to the new job");
        }
      }

      return {
        id: jobId,
        title: String(job.title),
        status: String(job.status),
        rubricId,
        rubricVersionId,
        ...(input.hiringRequestId
          ? { hiringRequestId: input.hiringRequestId, hiringRequestStatus: "recruiting" }
          : {}),
      };
    });
  }

  async createCandidate(input: CreateCandidateDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const normalizedEmail = input.primaryEmail?.trim().toLowerCase();
    const normalizedPhone = input.primaryPhone?.trim().replace(/\s+/g, "");

    return this.database.sql.begin(async (tx) => {
      if (normalizedEmail) {
        const existing = await tx`
          SELECT id::text
          FROM candidates
          WHERE organization_id = ${organizationId}::uuid
            AND lower(primary_email) = ${normalizedEmail}
          LIMIT 1
        `;
        if (existing[0]) throw new BadRequestException("A candidate with this email already exists");
      }

      const rows = await tx`
        INSERT INTO candidates (
          organization_id, display_name, primary_email, primary_phone,
          "current_role", current_company, location, preferred_language
        ) VALUES (
          ${organizationId}::uuid,
          ${input.displayName.trim()},
          ${normalizedEmail ?? null},
          ${input.primaryPhone?.trim() || null},
          ${input.currentRole?.trim() || null},
          ${input.currentCompany?.trim() || null},
          ${input.location?.trim() || null},
          ${input.preferredLanguage?.trim() || null}
        )
        RETURNING id::text, display_name, primary_email, primary_phone,
                  "current_role" AS current_role, current_company, location, preferred_language, created_at
      `;
      const candidate = rows[0];
      if (!candidate?.id) throw new BadRequestException("Candidate could not be created");
      const candidateId = String(candidate.id);

      const identities = [
        normalizedEmail ? { type: "email", value: normalizedEmail } : undefined,
        normalizedPhone ? { type: "phone", value: normalizedPhone } : undefined,
      ].filter((value): value is { type: string; value: string } => Boolean(value));

      for (const identity of identities) {
        const inserted = await tx`
          INSERT INTO candidate_identities (
            organization_id, candidate_id, identity_type, normalized_value, is_verified
          ) VALUES (
            ${organizationId}::uuid,
            ${candidateId}::uuid,
            ${identity.type},
            ${identity.value},
            false
          )
          ON CONFLICT (organization_id, identity_type, normalized_value) DO NOTHING
          RETURNING id::text
        `;
        if (!inserted[0]) {
          throw new BadRequestException(`A candidate with this ${identity.type} identity already exists`);
        }
      }

      return {
        id: candidateId,
        displayName: String(candidate.display_name),
        ...(candidate.primary_email ? { primaryEmail: String(candidate.primary_email) } : {}),
        ...(candidate.primary_phone ? { primaryPhone: String(candidate.primary_phone) } : {}),
        ...(candidate.current_role ? { currentRole: String(candidate.current_role) } : {}),
        ...(candidate.current_company ? { currentCompany: String(candidate.current_company) } : {}),
        ...(candidate.location ? { location: String(candidate.location) } : {}),
        ...(candidate.preferred_language ? { preferredLanguage: String(candidate.preferred_language) } : {}),
        createdAt: new Date(String(candidate.created_at)).toISOString(),
      };
    });
  }

  async updateCandidate(candidateId: string, input: UpdateCandidateDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const normalizedEmail = typeof input.primaryEmail === "string" ? input.primaryEmail.trim().toLowerCase() : null;
    const normalizedPhone = typeof input.primaryPhone === "string" ? input.primaryPhone.trim().replace(/\s+/g, "") : null;

    return this.database.sql.begin(async (tx) => {
      const existing = await tx`
        SELECT id::text
        FROM candidates
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${candidateId}::uuid
        LIMIT 1
        FOR UPDATE
      `;
      if (!existing[0]) throw new NotFoundException("Candidate not found");

      if (normalizedEmail) {
        const duplicateEmail = await tx`
          SELECT candidate_id::text
          FROM candidate_identities
          WHERE organization_id = ${organizationId}::uuid
            AND identity_type = 'email'
            AND normalized_value = ${normalizedEmail}
            AND candidate_id <> ${candidateId}::uuid
          LIMIT 1
        `;
        if (duplicateEmail[0]) throw new BadRequestException("A candidate with this email already exists");
      }

      if (normalizedPhone) {
        const duplicatePhone = await tx`
          SELECT candidate_id::text
          FROM candidate_identities
          WHERE organization_id = ${organizationId}::uuid
            AND identity_type = 'phone'
            AND normalized_value = ${normalizedPhone}
            AND candidate_id <> ${candidateId}::uuid
          LIMIT 1
        `;
        if (duplicatePhone[0]) throw new BadRequestException("A candidate with this phone identity already exists");
      }

      const rows = await tx`
        UPDATE candidates
        SET display_name = CASE WHEN ${input.displayName !== undefined} THEN ${input.displayName?.trim() || null} ELSE display_name END,
            primary_email = CASE WHEN ${input.primaryEmail !== undefined} THEN ${normalizedEmail} ELSE primary_email END,
            primary_phone = CASE WHEN ${input.primaryPhone !== undefined} THEN ${typeof input.primaryPhone === "string" ? input.primaryPhone.trim() || null : null} ELSE primary_phone END,
            "current_role" = CASE WHEN ${input.currentRole !== undefined} THEN ${typeof input.currentRole === "string" ? input.currentRole.trim() || null : null} ELSE "current_role" END,
            current_company = CASE WHEN ${input.currentCompany !== undefined} THEN ${typeof input.currentCompany === "string" ? input.currentCompany.trim() || null : null} ELSE current_company END,
            location = CASE WHEN ${input.location !== undefined} THEN ${typeof input.location === "string" ? input.location.trim() || null : null} ELSE location END,
            preferred_language = CASE WHEN ${input.preferredLanguage !== undefined} THEN ${typeof input.preferredLanguage === "string" ? input.preferredLanguage.trim() || null : null} ELSE preferred_language END,
            updated_at = now()
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${candidateId}::uuid
        RETURNING id::text, display_name, primary_email, primary_phone,
                  "current_role" AS current_role, current_company, location, preferred_language, updated_at
      `;

      if (input.primaryEmail !== undefined) {
        await tx`
          DELETE FROM candidate_identities
          WHERE organization_id = ${organizationId}::uuid
            AND candidate_id = ${candidateId}::uuid
            AND identity_type = 'email'
        `;
        if (normalizedEmail) {
          await tx`
            INSERT INTO candidate_identities (
              organization_id, candidate_id, identity_type, normalized_value, is_verified
            ) VALUES (
              ${organizationId}::uuid, ${candidateId}::uuid, 'email', ${normalizedEmail}, false
            )
          `;
        }
      }

      if (input.primaryPhone !== undefined) {
        await tx`
          DELETE FROM candidate_identities
          WHERE organization_id = ${organizationId}::uuid
            AND candidate_id = ${candidateId}::uuid
            AND identity_type = 'phone'
        `;
        if (normalizedPhone) {
          await tx`
            INSERT INTO candidate_identities (
              organization_id, candidate_id, identity_type, normalized_value, is_verified
            ) VALUES (
              ${organizationId}::uuid, ${candidateId}::uuid, 'phone', ${normalizedPhone}, false
            )
          `;
        }
      }

      const candidate = rows[0];
      return {
        id: String(candidate?.id),
        displayName: String(candidate?.display_name),
        ...(candidate?.primary_email ? { primaryEmail: String(candidate.primary_email) } : {}),
        ...(candidate?.primary_phone ? { primaryPhone: String(candidate.primary_phone) } : {}),
        ...(candidate?.current_role ? { currentRole: String(candidate.current_role) } : {}),
        ...(candidate?.current_company ? { currentCompany: String(candidate.current_company) } : {}),
        ...(candidate?.location ? { location: String(candidate.location) } : {}),
        ...(candidate?.preferred_language ? { preferredLanguage: String(candidate.preferred_language) } : {}),
        updatedAt: new Date(String(candidate?.updated_at)).toISOString(),
      };
    });
  }

  async deleteCandidate(candidateId: string) {
    const result = await this.bulkDeleteCandidates([candidateId]);
    if (result.deletedCount === 0) {
      throw new BadRequestException("Candidate cannot be deleted while linked to an application");
    }
    return { id: candidateId, deleted: true as const };
  }

  async bulkDeleteCandidates(candidateIds: string[], cascadeApplications = false) {
    const organizationId = this.tenantContext.require().organizationId;
    const uniqueIds = [...new Set(candidateIds)];

    return this.database.sql.begin(async (tx) => {
      if (cascadeApplications) {
        const existing = await tx`
          SELECT c.id::text
          FROM candidates c
          WHERE c.organization_id = ${organizationId}::uuid
            AND c.id = ANY(${uniqueIds}::uuid[])
          FOR UPDATE
        `;
        const deletedIds = existing.map((row) => String(row.id));

        if (deletedIds.length > 0) {
          await tx`
            DELETE FROM candidates
            WHERE organization_id = ${organizationId}::uuid
              AND id = ANY(${deletedIds}::uuid[])
          `;
        }

        const blockedIds = uniqueIds.filter((id) => !deletedIds.includes(id));
        return { deletedIds, deletedCount: deletedIds.length, blockedIds };
      }

      const deletable = await tx`
        SELECT c.id::text
        FROM candidates c
        WHERE c.organization_id = ${organizationId}::uuid
          AND c.id = ANY(${uniqueIds}::uuid[])
          AND NOT EXISTS (
            SELECT 1
            FROM applications a
            WHERE a.organization_id = c.organization_id
              AND a.candidate_id = c.id
          )
        FOR UPDATE
      `;
      const deletedIds = deletable.map((row) => String(row.id));

      if (deletedIds.length > 0) {
        await tx`
          DELETE FROM candidates
          WHERE organization_id = ${organizationId}::uuid
            AND id = ANY(${deletedIds}::uuid[])
        `;
      }

      const blockedIds = uniqueIds.filter((id) => !deletedIds.includes(id));
      return { deletedIds, deletedCount: deletedIds.length, blockedIds };
    });
  }

  async createApplication(jobId: string, input: CreateApplicationDto) {
    const organizationId = this.tenantContext.require().organizationId;

    return this.database.sql.begin(async (tx) => {
      const candidate = await tx`
        SELECT id::text
        FROM candidates
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${input.candidateId}::uuid
        LIMIT 1
      `;
      if (!candidate[0]) throw new NotFoundException("Candidate not found");

      const job = await tx`
        SELECT id::text
        FROM jobs
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${jobId}::uuid
        LIMIT 1
      `;
      if (!job[0]) throw new NotFoundException("Job not found");

      const existing = await tx`
        SELECT id::text, rubric_version_id::text, status, pipeline_stage, source, created_at
        FROM applications
        WHERE organization_id = ${organizationId}::uuid
          AND job_id = ${jobId}::uuid
          AND candidate_id = ${input.candidateId}::uuid
        LIMIT 1
      `;
      if (existing[0]) {
        return {
          id: String(existing[0].id),
          jobId,
          candidateId: input.candidateId,
          rubricVersionId: String(existing[0].rubric_version_id),
          status: String(existing[0].status),
          pipelineStage: String(existing[0].pipeline_stage),
          ...(existing[0].source ? { source: String(existing[0].source) } : {}),
          createdAt: new Date(String(existing[0].created_at)).toISOString(),
          alreadyExisted: true,
        };
      }

      const rubricVersions = await tx`
        SELECT rv.id::text
        FROM rubrics r
        JOIN rubric_versions rv
          ON rv.organization_id = r.organization_id
         AND rv.rubric_id = r.id
        WHERE r.organization_id = ${organizationId}::uuid
          AND r.job_id = ${jobId}::uuid
          AND rv.status = 'published'
        ORDER BY rv.version DESC
        LIMIT 1
      `;
      const rubricVersionId = rubricVersions[0]?.id ? String(rubricVersions[0].id) : undefined;
      if (!rubricVersionId) {
        throw new BadRequestException("Publish the job rubric before creating an application");
      }

      const rows = await tx`
        INSERT INTO applications (
          organization_id, job_id, candidate_id, rubric_version_id, status, pipeline_stage, source
        ) VALUES (
          ${organizationId}::uuid,
          ${jobId}::uuid,
          ${input.candidateId}::uuid,
          ${rubricVersionId}::uuid,
          'active',
          ${input.pipelineStage?.trim() || "new"},
          ${input.source?.trim() || "manual"}
        )
        RETURNING id::text, rubric_version_id::text, status, pipeline_stage, source, created_at
      `;
      const application = rows[0];
      return {
        id: String(application?.id),
        jobId,
        candidateId: input.candidateId,
        rubricVersionId: String(application?.rubric_version_id),
        status: String(application?.status),
        pipelineStage: String(application?.pipeline_stage),
        ...(application?.source ? { source: String(application.source) } : {}),
        createdAt: new Date(String(application?.created_at)).toISOString(),
        alreadyExisted: false,
      };
    });
  }

  async updateJob(jobId: string, input: UpdateJobDto) {
    const organizationId = this.tenantContext.require().organizationId;
    if (input.status === "open") {
      throw new BadRequestException("Use the job publish action to open a job");
    }

    return this.database.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE jobs
        SET title = COALESCE(${input.title?.trim() || null}, title),
            status = COALESCE(${input.status ?? null}, status),
            department = CASE WHEN ${input.department !== undefined} THEN ${typeof input.department === "string" ? input.department.trim() || null : null} ELSE department END,
            location = CASE WHEN ${input.location !== undefined} THEN ${typeof input.location === "string" ? input.location.trim() || null : null} ELSE location END,
            seniority = CASE WHEN ${input.seniority !== undefined} THEN ${typeof input.seniority === "string" ? input.seniority.trim() || null : null} ELSE seniority END,
            summary = CASE WHEN ${input.summary !== undefined} THEN ${typeof input.summary === "string" ? input.summary.trim() || null : null} ELSE summary END,
            updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${jobId}::uuid
        RETURNING id::text, title, status, department, location, seniority, summary, updated_at
      `;
      if (!rows[0]) throw new NotFoundException("Job not found");

      if (input.requirements !== undefined) {
        await tx`
          DELETE FROM job_requirements
          WHERE organization_id = ${organizationId}::uuid
            AND job_id = ${jobId}::uuid
        `;

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
      }

      return rows[0];
    });
  }

  async deleteJob(jobId: string) {
    const result = await this.bulkDeleteJobs([jobId]);
    if (result.deletedCount === 0) {
      throw new BadRequestException("Only unlinked draft jobs without applications can be deleted");
    }
    return { id: jobId, deleted: true as const };
  }

  async bulkDeleteJobs(jobIds: string[]) {
    const organizationId = this.tenantContext.require().organizationId;
    const uniqueIds = [...new Set(jobIds)];

    return this.database.sql.begin(async (tx) => {
      const deletable = await tx`
        SELECT j.id::text
        FROM jobs j
        WHERE j.organization_id = ${organizationId}::uuid
          AND j.id = ANY(${uniqueIds}::uuid[])
          AND j.status = 'draft'
          AND NOT EXISTS (
            SELECT 1
            FROM applications a
            WHERE a.organization_id = j.organization_id
              AND a.job_id = j.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM hiring_requests hr
            WHERE hr.organization_id = j.organization_id
              AND hr.linked_job_id = j.id
          )
        FOR UPDATE
      `;
      const deletedIds = deletable.map((row) => String(row.id));

      if (deletedIds.length > 0) {
        await tx`
          DELETE FROM jobs
          WHERE organization_id = ${organizationId}::uuid
            AND id = ANY(${deletedIds}::uuid[])
        `;
      }

      const blockedIds = uniqueIds.filter((id) => !deletedIds.includes(id));
      return { deletedIds, deletedCount: deletedIds.length, blockedIds };
    });
  }

  async publishJob(jobId: string) {
    const organizationId = this.tenantContext.require().organizationId;

    return this.database.sql.begin(async (tx) => {
      const jobs = await tx`
        SELECT id::text, title, status
        FROM jobs
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${jobId}::uuid
        LIMIT 1
        FOR UPDATE
      `;
      const job = jobs[0];
      if (!job) throw new NotFoundException("Job not found");

      const currentStatus = String(job.status);
      if (["closed", "archived"].includes(currentStatus)) {
        throw new BadRequestException("Closed or archived jobs cannot be published");
      }

      const requirementCount = await tx`
        SELECT count(*)::int AS count
        FROM job_requirements
        WHERE organization_id = ${organizationId}::uuid
          AND job_id = ${jobId}::uuid
      `;
      if (Number(requirementCount[0]?.count ?? 0) === 0) {
        throw new BadRequestException("Define at least one job requirement before publication");
      }

      const drafts = await tx`
        SELECT rv.id::text, rv.version, r.id::text AS rubric_id
        FROM rubrics r
        JOIN rubric_versions rv
          ON rv.organization_id = r.organization_id
         AND rv.rubric_id = r.id
        WHERE r.organization_id = ${organizationId}::uuid
          AND r.job_id = ${jobId}::uuid
          AND rv.status = 'draft'
        ORDER BY rv.version DESC
        LIMIT 1
        FOR UPDATE OF rv
      `;

      let rubricVersion: number | undefined;
      const draft = drafts[0];

      if (draft?.id) {
        const criterionCount = await tx`
          SELECT count(*)::int AS count
          FROM rubric_criteria
          WHERE organization_id = ${organizationId}::uuid
            AND rubric_version_id = ${String(draft.id)}::uuid
        `;
        if (Number(criterionCount[0]?.count ?? 0) === 0) {
          throw new BadRequestException("Define at least one evaluation criterion before publication");
        }

        await tx`
          UPDATE rubric_versions
          SET status = 'published', published_at = now()
          WHERE organization_id = ${organizationId}::uuid
            AND id = ${String(draft.id)}::uuid
        `;
        await tx`
          UPDATE rubrics
          SET status = 'published', updated_at = now()
          WHERE organization_id = ${organizationId}::uuid
            AND id = ${String(draft.rubric_id)}::uuid
        `;
        rubricVersion = Number(draft.version);
      } else {
        const published = await tx`
          SELECT rv.version
          FROM rubrics r
          JOIN rubric_versions rv
            ON rv.organization_id = r.organization_id
           AND rv.rubric_id = r.id
          WHERE r.organization_id = ${organizationId}::uuid
            AND r.job_id = ${jobId}::uuid
            AND rv.status = 'published'
          ORDER BY rv.version DESC
          LIMIT 1
        `;
        if (!published[0]) {
          throw new BadRequestException("Publish an evaluation framework before publishing the job");
        }
        rubricVersion = Number(published[0].version);
      }

      const opened = await tx`
        UPDATE jobs
        SET status = 'open', updated_at = now()
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${jobId}::uuid
        RETURNING id::text, title, status
      `;

      return {
        id: String(opened[0]?.id),
        title: String(opened[0]?.title),
        status: "open" as const,
        ...(rubricVersion !== undefined ? { rubricVersion } : {}),
        rubricPublished: true,
      };
    });
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
            ${tx.json(criterionEvidencePolicy(criterion) as never)},
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
      SELECT a.rubric_version_id::text
      FROM applications a
      JOIN rubric_criteria rc
        ON rc.organization_id = a.organization_id
       AND rc.rubric_version_id = a.rubric_version_id
      WHERE a.organization_id = ${organizationId}::uuid
        AND a.id = ${applicationId}::uuid
        AND rc.id = ${input.criterionId}::uuid
      LIMIT 1
    `;
    const rubricVersionId = context[0]?.rubric_version_id
      ? String(context[0].rubric_version_id)
      : undefined;
    if (!rubricVersionId) {
      throw new BadRequestException("Criterion does not belong to the application pinned rubric version");
    }
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
    const applications = await this.database.sql`
      SELECT rubric_version_id::text
      FROM applications
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${applicationId}::uuid
      LIMIT 1
    `;
    const rubricVersionId = applications[0]?.rubric_version_id
      ? String(applications[0].rubric_version_id)
      : undefined;
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
        ORDER BY e.created_at DESC, e.id DESC
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
      ON CONFLICT (
        organization_id, application_id, rubric_version_id, algorithm_version, input_fingerprint
      ) DO UPDATE SET input_fingerprint = EXCLUDED.input_fingerprint
      RETURNING id::text, created_at, input_fingerprint
    `;
    return {
      persisted: true,
      scorecardId: String(scorecards[0]?.id),
      inputFingerprint: String(scorecards[0]?.input_fingerprint),
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
        SELECT a.id::text, a.job_id::text, hr.id::text AS hiring_request_id
        FROM applications a
        LEFT JOIN hiring_requests hr
          ON hr.organization_id = a.organization_id
         AND hr.linked_job_id = a.job_id
        WHERE a.organization_id = ${organizationId}::uuid
          AND a.id = ${applicationId}::uuid
        LIMIT 1
        FOR UPDATE OF a
      `;
      const application = applications[0];
      if (!application) throw new NotFoundException("Application not found");

      if (input.decision === "hire" && application.hiring_request_id) {
        const approvals = await tx`
          SELECT decision
          FROM application_technical_approvals
          WHERE organization_id = ${organizationId}::uuid
            AND application_id = ${applicationId}::uuid
            AND hiring_request_id = ${String(application.hiring_request_id)}::uuid
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `;
        const latestApproval = approvals[0]?.decision ? String(approvals[0].decision) : undefined;
        if (!canSubmitRequisitionBackedHire(true, latestApproval)) {
          throw new BadRequestException(
            "Requesting-team technical approval is required before a requisition-backed application can be hired",
          );
        }
      }

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
          ${JSON.stringify({ technicalApprovalRequired: Boolean(application.hiring_request_id) })}::jsonb
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

        if (input.decision === "hire" && application.hiring_request_id) {
          await tx`
            UPDATE hiring_requests hr
            SET status = CASE
                  WHEN (
                    SELECT count(*)::int
                    FROM applications a
                    WHERE a.organization_id = hr.organization_id
                      AND a.job_id = hr.linked_job_id
                      AND a.pipeline_stage = 'hired'
                  ) >= hr.headcount THEN 'filled'
                  ELSE hr.status
                END,
                updated_at = now()
            WHERE hr.organization_id = ${organizationId}::uuid
              AND hr.id = ${String(application.hiring_request_id)}::uuid
          `;

          await tx`
            UPDATE jobs j
            SET status = 'closed', updated_at = now()
            FROM hiring_requests hr
            WHERE hr.organization_id = ${organizationId}::uuid
              AND hr.id = ${String(application.hiring_request_id)}::uuid
              AND hr.status = 'filled'
              AND j.organization_id = hr.organization_id
              AND j.id = hr.linked_job_id
          `;
        }
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
      SELECT a.id::text, a.job_id::text, a.candidate_id::text, a.rubric_version_id::text,
             a.status, a.pipeline_stage, a.pre_interview_match_score,
             j.title AS job_title, c.display_name AS candidate_name
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
      SELECT id::text, rubric_version_id::text, overall_score, recommendation, algorithm_version,
             input_fingerprint, review_state, created_at
      FROM scorecards
      WHERE organization_id = ${organizationId}::uuid AND application_id = ${applicationId}::uuid
      ORDER BY created_at DESC
    `;
    const scorecardInputs = await this.database.sql`
      SELECT si.scorecard_id::text, si.criterion_evaluation_id::text, si.criterion_id::text,
             si.weight, si.score, si.evidence_ids, si.created_at
      FROM scorecard_inputs si
      JOIN scorecards s
        ON s.organization_id = si.organization_id AND s.id = si.scorecard_id
      WHERE si.organization_id = ${organizationId}::uuid
        AND s.application_id = ${applicationId}::uuid
      ORDER BY si.scorecard_id, si.criterion_id
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
    return { application: applications[0], transitions, scorecards, scorecardInputs, decisions, evidence };
  }
}
