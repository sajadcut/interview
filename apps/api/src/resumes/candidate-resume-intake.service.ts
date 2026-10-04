import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AiJobQueueService } from "../ai/ai-job-queue.service";
import { DatabaseService } from "../database/database.service";
import {
  calculateEvidenceConceptMatch,
  type MatchRequirement,
} from "../sourcing/evidence-match-engine";
import { TenantContextService } from "../tenant/tenant-context.service";
import type {
  CandidateJobMatchAnalysisStatusDto,
  CandidateJobMatchDto,
  CandidateMatchApplicationDto,
  CandidateResumeIntakeDto,
} from "./candidate-resume-intake.dto";
import { ResumeIngestionService, type ResumeUpload } from "./resume-ingestion.service";
import { ResumeParser } from "./resume-parser";
import { MAX_RESUME_BYTES, ResumeTextExtractor } from "./resume-text-extractor";

function filenameDisplayName(originalName: string): string {
  const withoutExtension = originalName.replace(/\.(pdf|docx|txt)$/i, "");
  return withoutExtension
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "کاندید رزومه";
}

function inferDisplayName(text: string, originalName: string): string {
  const sectionLike = /^(resume|cv|curriculum vitae|profile|summary|skills?|experience|education|رزومه|خلاصه|مهارت|سوابق|تحصیلات)\b/i;
  const emailLike = /@|https?:\/\/|www\.|linkedin/i;
  const phoneLike = /\+?\d[\d\s().-]{6,}/;
  const dateLike = /\b(?:19|20)\d{2}\b/;
  const candidates = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 18);

  for (const line of candidates) {
    if (line.length < 3 || line.length > 80) continue;
    if (sectionLike.test(line) || emailLike.test(line) || phoneLike.test(line) || dateLike.test(line)) continue;
    if (!/[\p{L}]/u.test(line)) continue;
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 7) continue;
    return line.slice(0, 240);
  }
  return filenameDisplayName(originalName);
}

@Injectable()
export class CandidateResumeIntakeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly resumes: ResumeIngestionService,
    private readonly extractor: ResumeTextExtractor,
    private readonly parser: ResumeParser,
    private readonly aiJobs: AiJobQueueService,
  ) {}

  async ingest(upload: ResumeUpload): Promise<CandidateResumeIntakeDto> {
    const organizationId = this.tenantContext.require().organizationId;
    if (upload.data.byteLength === 0 || upload.data.byteLength > MAX_RESUME_BYTES) {
      throw new BadRequestException("Resume must be between 1 byte and 10 MB");
    }

    const extracted = await this.extractor.extract(upload);
    const profile = this.parser.parse(extracted.text);
    const displayName = inferDisplayName(extracted.text, upload.originalName);
    const resolved = await this.resolveCandidate(organizationId, {
      displayName,
      email: profile.email,
      phone: profile.phone,
      currentRole: profile.currentRole,
      currentCompany: profile.currentCompany,
      location: profile.location,
      preferredLanguage: profile.preferredLanguage,
    });

    const resume = await this.resumes.ingest(resolved.candidateId, upload);
    const matches = await this.matchJobs(resolved.candidateId);
    const analysisJobId = await this.enqueueAnalysis({
      organizationId,
      candidateId: resolved.candidateId,
      resumeId: resume.id,
      profile: resume.structuredProfile,
      matches,
    });

    return {
      candidateId: resolved.candidateId,
      candidateDisplayName: resolved.displayName,
      reusedExistingCandidate: resolved.reusedExistingCandidate,
      resume,
      matches,
      ...(analysisJobId ? { analysisJobId } : {}),
    };
  }

  async matchJobs(candidateId: string): Promise<CandidateJobMatchDto[]> {
    const organizationId = this.tenantContext.require().organizationId;
    const candidate = await this.database.sql`
      SELECT id::text
      FROM candidates
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${candidateId}::uuid
      LIMIT 1
    `;
    if (!candidate[0]) throw new NotFoundException("Candidate not found");

    const [skills, experiences, jobs, requirements] = await Promise.all([
      this.database.sql`
        SELECT skill_label, verification_state, source_reference
        FROM candidate_skills
        WHERE organization_id = ${organizationId}::uuid
          AND candidate_id = ${candidateId}::uuid
      `,
      this.database.sql`
        SELECT title, description, source_reference
        FROM candidate_experiences
        WHERE organization_id = ${organizationId}::uuid
          AND candidate_id = ${candidateId}::uuid
      `,
      this.database.sql`
        SELECT
          j.id::text,
          j.title,
          j.status,
          j.department,
          j.location,
          j.seniority,
          published.id::text AS published_rubric_version_id,
          a.id::text AS application_id
        FROM jobs j
        LEFT JOIN LATERAL (
          SELECT rv.id
          FROM rubrics r
          JOIN rubric_versions rv
            ON rv.organization_id = r.organization_id
           AND rv.rubric_id = r.id
          WHERE r.organization_id = j.organization_id
            AND r.job_id = j.id
            AND rv.status = 'published'
          ORDER BY rv.version DESC
          LIMIT 1
        ) published ON true
        LEFT JOIN applications a
          ON a.organization_id = j.organization_id
         AND a.job_id = j.id
         AND a.candidate_id = ${candidateId}::uuid
        WHERE j.organization_id = ${organizationId}::uuid
          AND j.status NOT IN ('closed', 'archived')
        ORDER BY j.updated_at DESC
      `,
      this.database.sql`
        SELECT
          jr.job_id::text,
          jr.id::text,
          jr.name,
          jr.description,
          jr.weight,
          jr.requirement_type
        FROM job_requirements jr
        JOIN jobs j
          ON j.organization_id = jr.organization_id
         AND j.id = jr.job_id
        WHERE jr.organization_id = ${organizationId}::uuid
          AND j.status NOT IN ('closed', 'archived')
      `,
    ]);

    const requirementsByJob = new Map<string, MatchRequirement[]>();
    for (const row of requirements) {
      const jobId = String(row.job_id);
      const current = requirementsByJob.get(jobId) ?? [];
      current.push({
        id: String(row.id),
        name: String(row.name),
        ...(row.description ? { description: String(row.description) } : {}),
        weight: Number(row.weight),
        requirementType: String(row.requirement_type) as "must_have" | "nice_to_have",
      });
      requirementsByJob.set(jobId, current);
    }

    const candidateSkills = skills.map((row) => ({
      label: String(row.skill_label),
      ...(row.verification_state ? { verificationState: String(row.verification_state) } : {}),
      ...(row.source_reference ? { sourceReference: String(row.source_reference) } : {}),
    }));
    const candidateExperiences = experiences.map((row) => ({
      title: String(row.title),
      ...(row.description ? { description: String(row.description) } : {}),
      ...(row.source_reference ? { sourceReference: String(row.source_reference) } : {}),
    }));

    return jobs
      .map((job) => {
        const jobId = String(job.id);
        const result = calculateEvidenceConceptMatch({
          requirements: requirementsByJob.get(jobId) ?? [],
          skills: candidateSkills,
          experiences: candidateExperiences,
        });
        const byId = new Map(result.components.map((component) => [component.requirementId, component]));
        const missingMustHaveRequirements = (requirementsByJob.get(jobId) ?? [])
          .filter((requirement) => result.missingMustHaveRequirementIds.includes(requirement.id))
          .map((requirement) => requirement.name);
        const matchedRequirements = (requirementsByJob.get(jobId) ?? [])
          .filter((requirement) => byId.get(requirement.id)?.evidenceBacked)
          .map((requirement) => requirement.name);

        return {
          jobId,
          jobTitle: String(job.title),
          jobStatus: String(job.status),
          ...(job.department ? { department: String(job.department) } : {}),
          ...(job.location ? { location: String(job.location) } : {}),
          ...(job.seniority ? { seniority: String(job.seniority) } : {}),
          matchScore: result.score,
          algorithmVersion: result.algorithmVersion,
          matchedRequirements,
          missingMustHaveRequirements,
          rubricPublished: Boolean(job.published_rubric_version_id),
          ...(job.application_id ? { applicationId: String(job.application_id) } : {}),
        } satisfies CandidateJobMatchDto;
      })
      .sort((left, right) => right.matchScore - left.matchScore || left.jobTitle.localeCompare(right.jobTitle));
  }

  async acceptMatch(candidateId: string, jobId: string): Promise<CandidateMatchApplicationDto> {
    const organizationId = this.tenantContext.require().organizationId;
    const match = (await this.matchJobs(candidateId)).find((item) => item.jobId === jobId);
    if (!match) throw new NotFoundException("Matching job was not found");
    if (!match.rubricPublished) {
      throw new BadRequestException("Publish the job rubric before adding this candidate");
    }

    return this.database.sql.begin(async (tx) => {
      const existing = await tx`
        SELECT id::text, pipeline_stage, pre_interview_match_score
        FROM applications
        WHERE organization_id = ${organizationId}::uuid
          AND candidate_id = ${candidateId}::uuid
          AND job_id = ${jobId}::uuid
        LIMIT 1
      `;
      if (existing[0]) {
        return {
          applicationId: String(existing[0].id),
          candidateId,
          jobId,
          preInterviewMatchScore:
            existing[0].pre_interview_match_score === null
              ? match.matchScore
              : Number(existing[0].pre_interview_match_score),
          pipelineStage: String(existing[0].pipeline_stage),
          alreadyExisted: true,
        };
      }

      const rubric = await tx`
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
      const rubricVersionId = rubric[0]?.id ? String(rubric[0].id) : undefined;
      if (!rubricVersionId) {
        throw new BadRequestException("Publish the job rubric before adding this candidate");
      }

      const inserted = await tx`
        INSERT INTO applications (
          organization_id,
          job_id,
          candidate_id,
          rubric_version_id,
          status,
          pipeline_stage,
          source,
          pre_interview_match_score
        ) VALUES (
          ${organizationId}::uuid,
          ${jobId}::uuid,
          ${candidateId}::uuid,
          ${rubricVersionId}::uuid,
          'active',
          'new',
          'resume_match_review',
          ${match.matchScore}
        )
        RETURNING id::text, pipeline_stage
      `;
      return {
        applicationId: String(inserted[0]?.id),
        candidateId,
        jobId,
        preInterviewMatchScore: match.matchScore,
        pipelineStage: String(inserted[0]?.pipeline_stage ?? "new"),
        alreadyExisted: false,
      };
    });
  }

  async getAnalysis(analysisJobId: string): Promise<CandidateJobMatchAnalysisStatusDto> {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT id::text, status, result, last_error_message
      FROM ai_jobs
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${analysisJobId}::uuid
        AND capability = 'candidate.job_match'
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException("Candidate job-match analysis was not found");
    const result = row.result && typeof row.result === "object"
      ? row.result as Record<string, unknown>
      : {};
    const output = result.output && typeof result.output === "object"
      ? result.output as Record<string, unknown>
      : {};
    const matches = Array.isArray(output.matches) ? output.matches : undefined;
    return {
      analysisJobId,
      status: String(row.status),
      ...(matches ? { matches: matches as CandidateJobMatchAnalysisStatusDto["matches"] } : {}),
      ...(row.last_error_message ? { errorMessage: String(row.last_error_message) } : {}),
    };
  }

  private async resolveCandidate(
    organizationId: string,
    profile: {
      displayName: string;
      email: string | null;
      phone: string | null;
      currentRole: string | null;
      currentCompany: string | null;
      location: string | null;
      preferredLanguage: string | null;
    },
  ): Promise<{ candidateId: string; displayName: string; reusedExistingCandidate: boolean }> {
    if (profile.email) {
      const existing = await this.database.sql`
        SELECT DISTINCT c.id::text, c.display_name
        FROM candidates c
        LEFT JOIN candidate_identities ci
          ON ci.organization_id = c.organization_id
         AND ci.candidate_id = c.id
        WHERE c.organization_id = ${organizationId}::uuid
          AND (
            lower(c.primary_email) = lower(${profile.email})
            OR (
              ci.identity_type IN ('email', 'candidate_portal_email')
              AND lower(ci.normalized_value) = lower(${profile.email})
            )
          )
        LIMIT 1
      `;
      if (existing[0]) {
        return {
          candidateId: String(existing[0].id),
          displayName: String(existing[0].display_name),
          reusedExistingCandidate: true,
        };
      }
    }

    const rows = await this.database.sql`
      INSERT INTO candidates (
        organization_id,
        display_name,
        primary_email,
        primary_phone,
        "current_role",
        current_company,
        location,
        preferred_language
      ) VALUES (
        ${organizationId}::uuid,
        ${profile.displayName},
        ${profile.email},
        ${profile.phone},
        ${profile.currentRole},
        ${profile.currentCompany},
        ${profile.location},
        ${profile.preferredLanguage}
      )
      RETURNING id::text, display_name
    `;
    return {
      candidateId: String(rows[0]?.id),
      displayName: String(rows[0]?.display_name),
      reusedExistingCandidate: false,
    };
  }

  private async enqueueAnalysis(input: {
    organizationId: string;
    candidateId: string;
    resumeId: string;
    profile: CandidateResumeIntakeDto["resume"]["structuredProfile"];
    matches: CandidateJobMatchDto[];
  }): Promise<string | undefined> {
    const topMatches = input.matches.slice(0, 8);
    if (topMatches.length === 0) return undefined;
    const job = await this.aiJobs.enqueue({
      organizationId: input.organizationId,
      capability: "candidate.job_match",
      idempotencyKey: `candidate-job-match:${input.candidateId}:${input.resumeId}`,
      timeoutMs: 45_000,
      payload: {
        capabilityVersion: "v1",
        promptId: "candidate.job_match",
        promptVersion: "v1",
        structuredOutputSchemaVersion: "candidate-job-match-analysis.v1",
        inputReferences: {
          candidateId: input.candidateId,
          resumeId: input.resumeId,
          jobIds: topMatches.map((match) => match.jobId),
        },
        input: {
          candidate: {
            currentRole: input.profile.currentRole,
            currentCompany: input.profile.currentCompany,
            skills: input.profile.skills.map((skill) => skill.label),
            experiences: input.profile.experiences.map((experience) => ({
              title: experience.title,
              company: experience.company,
              description: experience.description,
            })),
          },
          jobs: topMatches.map((match) => ({
            jobId: match.jobId,
            title: match.jobTitle,
            department: match.department ?? null,
            seniority: match.seniority ?? null,
            deterministicMatchScore: match.matchScore,
            matchedRequirements: match.matchedRequirements,
            missingMustHaveRequirements: match.missingMustHaveRequirements,
          })),
          boundaries: {
            deterministicScoreIsAuthoritative: true,
            llmMustNotChangeScore: true,
            recommendationIsDecisionSupportOnly: true,
          },
        },
      },
    });
    return job.id;
  }
}
