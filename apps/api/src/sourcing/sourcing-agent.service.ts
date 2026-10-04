import { createHash } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AiJobQueueService } from "../ai/ai-job-queue.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { ApprovedSourceTypes, type ApprovedSourceType } from "./candidate-source.adapter";
import { calculateEvidenceConceptMatch, type MatchRequirement } from "./evidence-match-engine";
import { CandidateSourceRegistry } from "./candidate-source.registry";
import { SourcingService } from "./sourcing.service";
import { TalentOperationsService } from "./talent-operations.service";
import type {
  CandidateFinderExecuteDto,
  CandidateFinderResultExplanationDto,
  CandidateFinderToolCallDto,
  JobTalentMatchExplanationDto,
} from "./sourcing.dto";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20);
}

@Injectable()
export class SourcingAgentService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly aiJobs: AiJobQueueService,
    private readonly sourceRegistry: CandidateSourceRegistry,
    private readonly sourcing: SourcingService,
    private readonly talent: TalentOperationsService,
  ) {}

  async startTalentAnalysis(jobId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const context = await this.jobContext(jobId);
    const matches = await this.talent.listJobTalentMatches(jobId, 12);
    const candidates = matches.slice(0, 8).map((match) => ({
      candidateId: match.candidateId,
      displayName: match.displayName,
      currentRole: match.currentRole ?? null,
      currentCompany: match.currentCompany ?? null,
      skills: match.skills,
      deterministicMatchScore: match.matchScore,
      matchedRequirements: match.matchedRequirements,
      missingMustHaveRequirements: match.missingMustHaveRequirements,
    }));
    const fingerprint = stableFingerprint({
      job: context,
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        score: candidate.deterministicMatchScore,
        matchedRequirements: candidate.matchedRequirements,
        missingMustHaveRequirements: candidate.missingMustHaveRequirements,
      })),
    });
    const job = await this.aiJobs.enqueue({
      organizationId,
      capability: "job.talent_match_explain",
      idempotencyKey: `job-talent-match:v3:${jobId}:${fingerprint}`,
      timeoutMs: 45_000,
      payload: {
        capabilityVersion: "v1",
        promptId: "job.talent_match_explain",
        promptVersion: "v3",
        structuredOutputSchemaVersion: "job-talent-match-explain.v1",
        inputReferences: { jobId, candidateIds: candidates.map((candidate) => candidate.candidateId) },
        input: {
          job: context,
          candidates,
          boundaries: {
            deterministicScoreIsAuthoritative: true,
            llmMustNotChangeScore: true,
            recommendationIsDecisionSupportOnly: true,
          },
        },
      },
    });
    return { analysisJobId: job.id, status: job.status };
  }

  async getTalentAnalysis(analysisJobId: string) {
    const job = await this.requireAiJob(analysisJobId, "job.talent_match_explain");
    const output = record(record(job.result).output);
    const matches = Array.isArray(output.matches)
      ? output.matches.flatMap((item) => {
          const row = record(item);
          const candidateId = typeof row.candidateId === "string" ? row.candidateId : "";
          const fitSummary = typeof row.fitSummary === "string" ? row.fitSummary : "";
          if (!candidateId || !fitSummary) return [];
          return [{
            candidateId,
            fitSummary,
            strengths: stringArray(row.strengths),
            gaps: stringArray(row.gaps),
            confidence: typeof row.confidence === "number" ? row.confidence : 0,
          } satisfies JobTalentMatchExplanationDto];
        })
      : undefined;
    return {
      analysisJobId,
      status: job.status,
      ...(matches ? { matches } : {}),
      ...(job.lastErrorMessage ? { errorMessage: job.lastErrorMessage } : {}),
    };
  }

  async startCandidateFinder(jobId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const context = await this.jobContext(jobId);
    const capabilities = await this.sourceRegistry.capabilities(organizationId);
    const availableSources = capabilities
      .filter((capability) =>
        capability.configured &&
        capability.sourceType !== ApprovedSourceTypes.InternalTalentPool,
      )
      .map((capability) => ({
        sourceType: capability.sourceType,
        providerKey: capability.providerKey ?? null,
        requiresApproval: capability.requiresApproval,
      }));
    const fingerprint = stableFingerprint({ context, availableSources });
    const freshnessBucket = Math.floor(Date.now() / (5 * 60 * 1000));
    const job = await this.aiJobs.enqueue({
      organizationId,
      capability: "sourcing.plan",
      idempotencyKey: `candidate-finder-plan:${jobId}:${fingerprint}:${freshnessBucket}`,
      timeoutMs: 45_000,
      payload: {
        capabilityVersion: "v1",
        promptId: "sourcing.plan",
        promptVersion: "v1",
        structuredOutputSchemaVersion: "sourcing-plan.v1",
        inputReferences: { jobId },
        input: {
          job: context,
          availableSources,
          constraints: {
            useOnlyAvailableSources: true,
            noWebScraping: true,
            maxToolCalls: 4,
            maxResultsPerTool: 25,
          },
        },
      },
    });
    return { planJobId: job.id, status: job.status };
  }

  async getCandidateFinderPlan(jobId: string, planJobId: string) {
    const job = await this.requireAiJob(planJobId, "sourcing.plan");
    this.assertJobReference(job.payload, jobId);
    const output = record(record(job.result).output);
    const rawCalls = Array.isArray(output.toolCalls) ? output.toolCalls : [];
    const toolCalls = rawCalls.flatMap((item) => {
      const row = record(item);
      const sourceType = typeof row.sourceType === "string" ? row.sourceType : "";
      const query = typeof row.query === "string" ? row.query.trim() : "";
      const providerKey = typeof row.providerKey === "string" ? row.providerKey.trim() : undefined;
      const limit = typeof row.limit === "number"
        ? Math.max(1, Math.min(100, Math.floor(row.limit)))
        : 15;
      if (!query || !Object.values(ApprovedSourceTypes).includes(sourceType as ApprovedSourceType)) {
        return [];
      }
      return [{
        sourceType: sourceType as ApprovedSourceType,
        ...(providerKey ? { providerKey } : {}),
        query,
        limit,
      } satisfies CandidateFinderToolCallDto];
    });
    return {
      planJobId,
      status: job.status,
      ...(typeof output.rationale === "string" ? { rationale: output.rationale } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
      ...(job.lastErrorMessage ? { errorMessage: job.lastErrorMessage } : {}),
    };
  }

  async executeCandidateFinder(jobId: string, planJobId: string, input: CandidateFinderExecuteDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const plan = await this.getCandidateFinderPlan(jobId, planJobId);
    if (plan.status !== "succeeded") {
      throw new BadRequestException("Candidate finder plan is not ready");
    }
    if (!plan.toolCalls?.length) {
      throw new BadRequestException(
        "The sourcing plan contains no executable tool calls. Configure an approved ATS or external candidate source first.",
      );
    }

    const capabilities = await this.sourceRegistry.capabilities(organizationId);
    const configured = new Set(
      capabilities
        .filter((capability) => capability.configured)
        .map((capability) => `${capability.sourceType}:${capability.providerKey ?? ""}`),
    );

    const runs = [];
    for (const [index, call] of plan.toolCalls.entries()) {
      if (call.sourceType === ApprovedSourceTypes.InternalTalentPool) {
        throw new BadRequestException("External candidate finder cannot execute the internal talent-pool tool");
      }
      const key = `${call.sourceType}:${call.providerKey ?? ""}`;
      if (!configured.has(key)) {
        throw new BadRequestException(
          `Planned source ${call.sourceType}/${call.providerKey ?? "default"} is not configured for this organization`,
        );
      }
      if (input.approvalConfirmed !== true) {
        throw new BadRequestException("Explicit HR approval is required before executing external sourcing tools");
      }
      const run = await this.sourcing.runSource(jobId, {
        query: call.query,
        limit: call.limit,
        sourceType: call.sourceType,
        ...(call.providerKey ? { providerKey: call.providerKey } : {}),
        approvalConfirmed: true,
        idempotencyKey: `candidate-finder:${planJobId}:${index}`,
      });
      if (run) {
        await this.scoreDiscoveredRun(run.id, jobId);
        const refreshed = await this.sourcing.getRun(run.id);
        if (refreshed) {
          runs.push({
            ...refreshed,
            idempotentReplay: run.idempotentReplay ?? false,
            ...(call.providerKey ? { providerKey: call.providerKey } : {}),
          });
        }
      }
    }

    const analysisJobId = await this.enqueueFinderResultAnalysis(jobId, runs);
    return { planJobId, runs, ...(analysisJobId ? { analysisJobId } : {}) };
  }

  async getFinderResultAnalysis(analysisJobId: string) {
    const job = await this.requireAiJob(analysisJobId, "sourcing.result_explain");
    const output = record(record(job.result).output);
    const matches = Array.isArray(output.matches)
      ? output.matches.flatMap((item) => {
          const row = record(item);
          const discoveredCandidateId =
            typeof row.discoveredCandidateId === "string" ? row.discoveredCandidateId : "";
          const fitSummary = typeof row.fitSummary === "string" ? row.fitSummary : "";
          if (!discoveredCandidateId || !fitSummary) return [];
          return [{
            discoveredCandidateId,
            fitSummary,
            strengths: stringArray(row.strengths),
            gaps: stringArray(row.gaps),
            confidence: typeof row.confidence === "number" ? row.confidence : 0,
          } satisfies CandidateFinderResultExplanationDto];
        })
      : undefined;
    return {
      analysisJobId,
      status: job.status,
      ...(matches ? { matches } : {}),
      ...(job.lastErrorMessage ? { errorMessage: job.lastErrorMessage } : {}),
    };
  }

  async acceptDiscoveredCandidate(discoveredCandidateId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT
        d.id::text,
        d.candidate_id::text,
        d.source_type,
        d.profile_snapshot,
        d.normalized_identity,
        d.source_provenance,
        sr.job_id::text
      FROM discovered_candidates d
      JOIN sourcing_runs sr
        ON sr.organization_id = d.organization_id
       AND sr.id = d.sourcing_run_id
      WHERE d.organization_id = ${organizationId}::uuid
        AND d.id = ${discoveredCandidateId}::uuid
      LIMIT 1
    `;
    const discovered = rows[0];
    if (!discovered) throw new NotFoundException("Discovered candidate not found");

    const jobId = String(discovered.job_id);
    const profile = record(discovered.profile_snapshot);
    const identity = record(discovered.normalized_identity);
    const provenance = record(discovered.source_provenance);
    const email = typeof identity.email === "string" ? identity.email.trim().toLowerCase() : "";
    const displayName =
      typeof profile.displayName === "string" && profile.displayName.trim()
        ? profile.displayName.trim()
        : "کاندید کشف‌شده";
    const currentRole =
      typeof profile.currentRole === "string" && profile.currentRole.trim()
        ? profile.currentRole.trim()
        : undefined;
    const currentCompany =
      typeof profile.currentCompany === "string" && profile.currentCompany.trim()
        ? profile.currentCompany.trim()
        : undefined;
    const skills = stringArray(profile.skills);
    const evidenceReferences = stringArray(provenance.evidenceReferences);
    const sourceReference =
      typeof provenance.sourceUrl === "string"
        ? provenance.sourceUrl
        : evidenceReferences[0] ?? `discovered_candidate:${discoveredCandidateId}`;
    const providerKey =
      typeof provenance.providerKey === "string" && provenance.providerKey.trim()
        ? provenance.providerKey.trim()
        : "approved-source";

    const result = await this.database.sql.begin(async (tx) => {
      const rubricRows = await tx`
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
      const rubricVersionId = rubricRows[0]?.id ? String(rubricRows[0].id) : undefined;
      if (!rubricVersionId) {
        throw new BadRequestException("Publish the job rubric before adding a sourced candidate");
      }

      let candidateId = discovered.candidate_id ? String(discovered.candidate_id) : undefined;
      let importedCandidate = false;
      if (!candidateId && email) {
        const existing = await tx`
          SELECT id::text
          FROM candidates
          WHERE organization_id = ${organizationId}::uuid
            AND lower(primary_email) = lower(${email})
          LIMIT 1
        `;
        candidateId = existing[0]?.id ? String(existing[0].id) : undefined;
      }

      if (!candidateId) {
        const inserted = await tx`
          INSERT INTO candidates (
            organization_id, display_name, primary_email, "current_role", current_company
          ) VALUES (
            ${organizationId}::uuid,
            ${displayName},
            ${email || null},
            ${currentRole ?? null},
            ${currentCompany ?? null}
          )
          RETURNING id::text
        `;
        candidateId = String(inserted[0]?.id);
        importedCandidate = true;
      }

      for (const skill of skills) {
        const skillKey = skill
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}+#.-]+/gu, "-")
          .slice(0, 160);
        if (!skillKey) continue;
        await tx`
          INSERT INTO candidate_skills (
            organization_id, candidate_id, skill_key, skill_label,
            verification_state, confidence, source_reference
          ) VALUES (
            ${organizationId}::uuid,
            ${candidateId}::uuid,
            ${skillKey},
            ${skill.slice(0, 200)},
            'unverified',
            0.5,
            ${sourceReference}
          )
          ON CONFLICT (candidate_id, skill_key) DO NOTHING
        `;
      }

      await tx`
        INSERT INTO talent_pool_entries (organization_id, candidate_id, status, tags)
        VALUES (
          ${organizationId}::uuid,
          ${candidateId}::uuid,
          'active',
          ARRAY[${`sourced:${providerKey}`}]::text[]
        )
        ON CONFLICT (organization_id, candidate_id)
        DO UPDATE SET status = 'active', updated_at = now()
      `;

      const existingApplications = await tx`
        SELECT id::text
        FROM applications
        WHERE organization_id = ${organizationId}::uuid
          AND job_id = ${jobId}::uuid
          AND candidate_id = ${candidateId}::uuid
        LIMIT 1
      `;
      let applicationId = existingApplications[0]?.id
        ? String(existingApplications[0].id)
        : undefined;
      const applicationAlreadyExisted = Boolean(applicationId);
      if (!applicationId) {
        const applications = await tx`
          INSERT INTO applications (
            organization_id, job_id, candidate_id, rubric_version_id,
            status, pipeline_stage, source
          ) VALUES (
            ${organizationId}::uuid,
            ${jobId}::uuid,
            ${candidateId}::uuid,
            ${rubricVersionId}::uuid,
            'active',
            'new',
            ${(`sourcing:${String(discovered.source_type)}:${providerKey}`).slice(0, 120)}
          )
          RETURNING id::text
        `;
        applicationId = String(applications[0]?.id);
      }

      await tx`
        UPDATE discovered_candidates
        SET candidate_id = ${candidateId}::uuid,
            dedupe_state = 'resolved_internal',
            review_state = 'accepted'
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${discoveredCandidateId}::uuid
      `;

      return { candidateId, applicationId, importedCandidate, applicationAlreadyExisted };
    });

    const match = await this.talent.calculateMatch(jobId, {
      candidateId: result.candidateId,
      applicationId: result.applicationId,
    });
    return {
      discoveredCandidateId,
      candidateId: result.candidateId,
      applicationId: result.applicationId,
      preInterviewMatchScore: match.score,
      importedCandidate: result.importedCandidate,
      applicationAlreadyExisted: result.applicationAlreadyExisted,
    };
  }

  private async scoreDiscoveredRun(runId: string, jobId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const requirements = await this.database.sql`
      SELECT id::text, name, description, weight, requirement_type
      FROM job_requirements
      WHERE organization_id = ${organizationId}::uuid
        AND job_id = ${jobId}::uuid
    `;
    const normalizedRequirements: MatchRequirement[] = requirements.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      ...(row.description ? { description: String(row.description) } : {}),
      weight: Number(row.weight),
      requirementType: String(row.requirement_type) as "must_have" | "nice_to_have",
    }));
    const candidates = await this.database.sql`
      SELECT id::text, profile_snapshot
      FROM discovered_candidates
      WHERE organization_id = ${organizationId}::uuid
        AND sourcing_run_id = ${runId}::uuid
    `;
    for (const candidate of candidates) {
      const profile = record(candidate.profile_snapshot);
      const skills = stringArray(profile.skills).map((label) => ({
        label,
        verificationState: "unverified",
        sourceReference: `discovered_candidate:${String(candidate.id)}`,
      }));
      const currentRole =
        typeof profile.currentRole === "string" && profile.currentRole.trim()
          ? profile.currentRole.trim()
          : undefined;
      const result = calculateEvidenceConceptMatch({
        requirements: normalizedRequirements,
        skills,
        experiences: currentRole
          ? [{
              title: currentRole,
              ...(typeof profile.currentCompany === "string"
                ? { description: `Current company: ${profile.currentCompany}` }
                : {}),
              sourceReference: `discovered_candidate:${String(candidate.id)}`,
            }]
          : [],
      });
      await this.database.sql`
        UPDATE discovered_candidates
        SET pre_interview_match_score = ${result.score}
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${String(candidate.id)}::uuid
      `;
    }
  }

  private async enqueueFinderResultAnalysis(
    jobId: string,
    runs: Array<{ results?: Array<Record<string, unknown>> }>,
  ): Promise<string | undefined> {
    const organizationId = this.tenantContext.require().organizationId;
    const context = await this.jobContext(jobId);
    const candidates = runs
      .flatMap((run) => Array.isArray(run.results) ? run.results : [])
      .sort((left, right) =>
        Number(right.preInterviewMatchScore ?? -1) - Number(left.preInterviewMatchScore ?? -1),
      )
      .slice(0, 12)
      .map((candidate) => {
        const profile = record(candidate.profileSnapshot);
        const provenance = record(candidate.sourceProvenance);
        return {
          discoveredCandidateId: String(candidate.id),
          displayName: typeof profile.displayName === "string" ? profile.displayName : "Unknown candidate",
          currentRole: typeof profile.currentRole === "string" ? profile.currentRole : null,
          currentCompany: typeof profile.currentCompany === "string" ? profile.currentCompany : null,
          skills: stringArray(profile.skills),
          deterministicMatchScore:
            typeof candidate.preInterviewMatchScore === "number"
              ? candidate.preInterviewMatchScore
              : null,
          providerKey: typeof provenance.providerKey === "string" ? provenance.providerKey : null,
          evidenceSummary: stringArray(profile.evidenceSummary),
        };
      });
    if (!candidates.length) return undefined;

    const fingerprint = stableFingerprint({
      job: context,
      candidates: candidates.map((candidate) => ({
        discoveredCandidateId: candidate.discoveredCandidateId,
        score: candidate.deterministicMatchScore,
      })),
    });
    const job = await this.aiJobs.enqueue({
      organizationId,
      capability: "sourcing.result_explain",
      idempotencyKey: `candidate-finder-results:v2:${jobId}:${fingerprint}`,
      timeoutMs: 45_000,
      payload: {
        capabilityVersion: "v1",
        promptId: "sourcing.result_explain",
        promptVersion: "v2",
        structuredOutputSchemaVersion: "sourcing-result-explain.v1",
        inputReferences: {
          jobId,
          discoveredCandidateIds: candidates.map((candidate) => candidate.discoveredCandidateId),
        },
        input: {
          job: context,
          candidates,
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

  private async jobContext(jobId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const jobs = await this.database.sql`
      SELECT id::text, title, department, location, seniority, summary, status
      FROM jobs
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${jobId}::uuid
      LIMIT 1
    `;
    const job = jobs[0];
    if (!job) throw new NotFoundException("Job not found");
    const requirements = await this.database.sql`
      SELECT name, description, requirement_type, weight, minimum_years
      FROM job_requirements
      WHERE organization_id = ${organizationId}::uuid
        AND job_id = ${jobId}::uuid
      ORDER BY CASE requirement_type WHEN 'must_have' THEN 0 ELSE 1 END, weight DESC
    `;
    return {
      jobId,
      title: String(job.title),
      ...(job.department ? { department: String(job.department) } : {}),
      ...(job.location ? { location: String(job.location) } : {}),
      ...(job.seniority ? { seniority: String(job.seniority) } : {}),
      ...(job.summary ? { summary: String(job.summary) } : {}),
      status: String(job.status),
      requirements: requirements.map((requirement) => ({
        name: String(requirement.name),
        ...(requirement.description ? { description: String(requirement.description) } : {}),
        requirementType: String(requirement.requirement_type),
        weight: Number(requirement.weight),
        ...(requirement.minimum_years !== null
          ? { minimumYears: Number(requirement.minimum_years) }
          : {}),
      })),
    };
  }

  private async requireAiJob(jobId: string, capability: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT id::text, payload, status, result, last_error_message
      FROM ai_jobs
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${jobId}::uuid
        AND capability = ${capability}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException("AI sourcing job not found");
    return {
      payload: record(row.payload),
      status: String(row.status),
      result: record(row.result),
      lastErrorMessage: row.last_error_message ? String(row.last_error_message) : undefined,
    };
  }

  private assertJobReference(payload: Record<string, unknown>, expectedJobId: string) {
    const refs = record(payload.inputReferences);
    if (refs.jobId !== expectedJobId) {
      throw new BadRequestException("AI sourcing plan does not belong to this job");
    }
  }
}
