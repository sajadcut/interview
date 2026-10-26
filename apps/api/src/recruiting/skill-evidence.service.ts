import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type {
  JobSkillRequirementInputDto, ReviewedResumeSkillClaimDto,
  ReviewResumeSkillClaimDto,
} from "./skill-evidence.dto";

type SkillRequirementRow = Record<string, unknown>;
type SubmittedSkill = JobSkillRequirementInputDto;

function sameRequirement(existing: SkillRequirementRow, input: SubmittedSkill): boolean {
  return Boolean(existing.is_active)
    && Number(existing.required_level) === input.requiredLevel
    && Number(existing.weight) === input.weight
    && Boolean(existing.required) === input.required
    && Number(existing.minimum_evidence_count) === input.minimumEvidenceCount
    && String(existing.rubric_criterion_id ?? "") === String(input.rubricCriterionId ?? "");
}

function present(row: SkillRequirementRow) {
  return {
    id: String(row.id),
    skillKey: String(row.skill_key),
    nameEn: String(row.name_en),
    ...(row.name_fa ? { nameFa: String(row.name_fa) } : {}),
    category: String(row.category),
    requiredLevel: Number(row.required_level),
    weight: Number(row.weight),
    required: Boolean(row.required),
    minimumEvidenceCount: Number(row.minimum_evidence_count),
    ...(row.rubric_criterion_id ? { rubricCriterionId: String(row.rubric_criterion_id) } : {}),
    requirementVersion: Number(row.requirement_version),
  };
}

@Injectable()
export class SkillEvidenceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenant: TenantContextService,
    private readonly auth: AuthContextService,
  ) {}

  async listJobSkills(jobId: string) {
    const organizationId = this.tenant.require().organizationId;
    const jobs = await this.database.sql`
      SELECT id FROM jobs WHERE organization_id=${organizationId}::uuid AND id=${jobId}::uuid
        AND status <> 'deleted'
    `;
    if (!jobs[0]) throw new NotFoundException("Job not found");
    const rows = await this.database.sql`
      SELECT current.*, st.skill_key, st.name_en, st.name_fa, st.category
      FROM (
        SELECT DISTINCT ON (skill_id) *
        FROM job_skill_requirements
        WHERE organization_id=${organizationId}::uuid AND job_id=${jobId}::uuid
        ORDER BY skill_id, requirement_version DESC, created_at DESC
      ) current
      JOIN skill_taxonomy st
        ON st.organization_id=current.organization_id AND st.id=current.skill_id
      WHERE current.is_active = true
      ORDER BY current.required DESC, current.weight DESC, st.name_en
    `;
    return rows.map(present);
  }

  async replaceJobSkills(jobId: string, submitted: SubmittedSkill[]) {
    const organizationId = this.tenant.require().organizationId;
    if (submitted.length > 50) throw new BadRequestException("Maximum 50 job skills");
    const keys = new Set<string>();
    for (const skill of submitted) {
      if (keys.has(skill.skillKey)) throw new BadRequestException("Duplicate skill key");
      keys.add(skill.skillKey);
    }
    // Job row lock serializes concurrent updates. Store revisions, not in-place edits.
    await this.database.sql.begin(async (tx) => {
      const jobs = await tx`
        SELECT id FROM jobs WHERE organization_id=${organizationId}::uuid
          AND id=${jobId}::uuid AND status <> 'deleted' FOR UPDATE
      `;
      if (!jobs[0]) throw new NotFoundException("Job not found");
      const liveSessions = await tx`
        SELECT 1 FROM applications a
        JOIN interview_sessions s
          ON s.organization_id=a.organization_id AND s.application_id=a.id
        WHERE a.organization_id=${organizationId}::uuid AND a.job_id=${jobId}::uuid
          AND s.status NOT IN ('cancelled','failed')
        LIMIT 1
      `;
      if (liveSessions[0]) throw new ConflictException("Job skill configuration is locked after an interview session exists");

      const previous = await tx`
        SELECT current.*, st.skill_key, st.name_en, st.name_fa, st.category
        FROM (
          SELECT DISTINCT ON (skill_id) *
          FROM job_skill_requirements
          WHERE organization_id=${organizationId}::uuid AND job_id=${jobId}::uuid
          ORDER BY skill_id, requirement_version DESC, created_at DESC
        ) current
        JOIN skill_taxonomy st ON st.organization_id=current.organization_id AND st.id=current.skill_id
      `;
      const previousByKey = new Map(previous.map((row) => [String(row.skill_key), row]));
      for (const skill of submitted) {
        await tx`
          INSERT INTO skill_taxonomy(organization_id, skill_key, name_fa, name_en, category)
          VALUES (${organizationId}::uuid, ${skill.skillKey}, ${skill.nameFa ?? null},
            ${skill.nameEn}, ${skill.category})
          ON CONFLICT (organization_id, skill_key) DO NOTHING
        `;
        const taxonomy = await tx`
          SELECT id::text, name_en, name_fa, category FROM skill_taxonomy
          WHERE organization_id=${organizationId}::uuid AND skill_key=${skill.skillKey}
        `;
        const item = taxonomy[0];
        if (!item) throw new NotFoundException("Skill taxonomy was not found");
        // Existing taxonomy labels are independently governed: job edits cannot silently rename them.
        if (String(item.name_en) !== skill.nameEn || String(item.category) !== skill.category) {
          throw new BadRequestException("Skill key is already registered with different taxonomy metadata");
        }
        const last = previousByKey.get(skill.skillKey);
        if (last && sameRequirement(last, skill)) continue;
        await tx`
          INSERT INTO job_skill_requirements(
            organization_id, job_id, skill_id, required_level, weight, required,
            minimum_evidence_count, rubric_criterion_id, requirement_version, is_active
          )
          VALUES (
            ${organizationId}::uuid, ${jobId}::uuid, ${String(item.id)}::uuid,
            ${skill.requiredLevel}, ${skill.weight}, ${skill.required},
            ${skill.minimumEvidenceCount}, ${skill.rubricCriterionId ?? null}::uuid,
            ${Number(last?.requirement_version ?? 0) + 1}, true
          )
        `;
      }
      for (const [key, last] of previousByKey) {
        if (!last.is_active || keys.has(key)) continue;
        await tx`
          INSERT INTO job_skill_requirements(
            organization_id, job_id, skill_id, required_level, weight, required,
            minimum_evidence_count, rubric_criterion_id, requirement_version, is_active
          )
          VALUES (
            ${organizationId}::uuid, ${jobId}::uuid, ${String(last.skill_id)}::uuid,
            ${Number(last.required_level)}, ${Number(last.weight)}, ${Boolean(last.required)},
            ${Number(last.minimum_evidence_count)}, ${last.rubric_criterion_id ? String(last.rubric_criterion_id) : null}::uuid,
            ${Number(last.requirement_version) + 1}, false
          )
        `;
      }
    });
    return this.listJobSkills(jobId);
  }


  async reviewHistory(candidateId: string, claimId: string) {
    const organizationId = this.tenant.require().organizationId;
    const claim = await this.database.sql`
      SELECT id FROM resume_skill_claims
      WHERE organization_id=${organizationId}::uuid
        AND candidate_id=${candidateId}::uuid AND id=${claimId}::uuid
    `;
    if (!claim[0]) throw new NotFoundException("Resume skill claim not found");
    const events = await this.database.sql`
      SELECT id::text, review_version, previous_state, new_state, previous_skill_key,
             new_skill_key, reason, reviewer_user_id::text, created_at
      FROM resume_skill_claim_review_events
      WHERE organization_id=${organizationId}::uuid AND claim_id=${claimId}::uuid
      ORDER BY review_version ASC
    `;
    return events.map((row) => ({
      id: String(row.id),
      reviewVersion: Number(row.review_version),
      previousState: String(row.previous_state),
      reviewState: String(row.new_state),
      ...(row.previous_skill_key ? { previousSkillKey: String(row.previous_skill_key) } : {}),
      ...(row.new_skill_key ? { skillKey: String(row.new_skill_key) } : {}),
      reviewReason: String(row.reason),
      reviewerUserId: String(row.reviewer_user_id),
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
  }

  async reviewResumeClaim(
    candidateId: string, claimId: string, input: ReviewResumeSkillClaimDto,
  ): Promise<ReviewedResumeSkillClaimDto> {
    const organizationId = this.tenant.require().organizationId;
    const actor = this.auth.getOptional()?.userId;
    if (!actor) throw new UnauthorizedException("Authenticated reviewer required");
    const reason = input.reviewReason?.trim() ?? "";
    if (reason.length < 8 || reason.length > 1000) {
      throw new BadRequestException("Review reason must contain 8–1000 characters");
    }
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
      throw new BadRequestException("expectedVersion must be a nonnegative integer");
    }
    if (input.reviewState === "corrected") {
      if (!input.correctedSkillKey || !/^[a-z0-9][a-z0-9-]{0,159}$/.test(input.correctedSkillKey)) {
        throw new BadRequestException("Corrected claim requires an existing canonical skill key");
      }
    } else if (input.correctedSkillKey !== undefined) {
      throw new BadRequestException("correctedSkillKey is only allowed for a corrected claim");
    } else if (!["confirmed", "rejected"].includes(input.reviewState)) {
      throw new BadRequestException("Unsupported review state");
    }

    try {
      return await this.database.sql.begin(async (tx) => {
        const rows = await tx`
          SELECT rc.id, rc.review_version, rc.review_state, rc.reviewed_at, rc.skill_id,
                 st.skill_key
          FROM resume_skill_claims rc
          JOIN skill_taxonomy st
            ON st.organization_id=rc.organization_id AND st.id=rc.skill_id
          WHERE rc.organization_id=${organizationId}::uuid
            AND rc.candidate_id=${candidateId}::uuid AND rc.id=${claimId}::uuid
          FOR UPDATE OF rc
        `;
        const claim = rows[0];
        if (!claim) throw new NotFoundException("Resume skill claim not found");
        const previousVersion = Number(claim.review_version);
        if (previousVersion !== input.expectedVersion) {
          throw new ConflictException("Stale resume skill claim review version; reload before retry");
        }

        let skillId = String(claim.skill_id);
        let skillKey = String(claim.skill_key);
        if (input.reviewState === "corrected") {
          const mappings = await tx`
            SELECT id::text, skill_key FROM skill_taxonomy
            WHERE organization_id=${organizationId}::uuid
              AND skill_key=${input.correctedSkillKey!}
          `;
          if (!mappings[0]) throw new BadRequestException("Corrected skill must exist in the tenant taxonomy");
          skillId = String(mappings[0].id);
          skillKey = String(mappings[0].skill_key);
          if (skillId === String(claim.skill_id)) {
            throw new BadRequestException("Corrected mapping must differ from the current skill");
          }
        }
        const nextVersion = previousVersion + 1;
        const changed = await tx`
          UPDATE resume_skill_claims
          SET review_state=${input.reviewState}, review_reason=${reason},
              reviewed_at=now(), reviewed_by_user_id=${actor}::uuid,
              review_version=${nextVersion}, skill_id=${skillId}::uuid,
              mapping_origin=CASE WHEN ${input.reviewState}='corrected'
                THEN 'human_reviewed' ELSE mapping_origin END
          WHERE organization_id=${organizationId}::uuid AND candidate_id=${candidateId}::uuid
            AND id=${claimId}::uuid
          RETURNING reviewed_at
        `;
        await tx`
          INSERT INTO resume_skill_claim_review_events (
            organization_id, claim_id, reviewer_user_id, previous_state, new_state,
            reason, review_version, previous_skill_key, new_skill_key
          ) VALUES (
            ${organizationId}::uuid, ${claimId}::uuid, ${actor}::uuid,
            ${String(claim.review_state)}, ${input.reviewState}, ${reason},
            ${nextVersion}, ${String(claim.skill_key)}, ${skillKey}
          )
        `;
        return {
          claimId, reviewState: input.reviewState, reviewReason: reason,
          reviewerUserId: actor, reviewedAt: new Date(String(changed[0]!.reviewed_at)).toISOString(),
          skillKey, reviewVersion: nextVersion,
        };
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "23505") {
        throw new ConflictException("The resume already has a claim mapped to that skill");
      }
      throw error;
    }
  }
}
