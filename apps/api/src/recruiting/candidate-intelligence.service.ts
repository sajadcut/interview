import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";

@Injectable()
export class CandidateIntelligenceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getWorkspace(candidateId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const candidates = await this.database.sql`
      SELECT id::text, display_name, primary_email, primary_phone,
             "current_role" AS current_role, current_company, location, preferred_language,
             created_at, updated_at
      FROM candidates
      WHERE organization_id = ${organizationId}::uuid AND id = ${candidateId}::uuid
      LIMIT 1
    `;
    if (!candidates[0]) throw new NotFoundException("Candidate not found");

    const experiences = await this.database.sql`
      SELECT id::text, company, title, started_on, ended_on, description, source_reference
      FROM candidate_experiences
      WHERE organization_id = ${organizationId}::uuid AND candidate_id = ${candidateId}::uuid
      ORDER BY COALESCE(ended_on, CURRENT_DATE) DESC, started_on DESC NULLS LAST
    `;
    const skills = await this.database.sql`
      SELECT id::text, skill_key, skill_label, verification_state, confidence, source_reference
      FROM candidate_skills
      WHERE organization_id = ${organizationId}::uuid AND candidate_id = ${candidateId}::uuid
      ORDER BY CASE verification_state WHEN 'verified' THEN 0 ELSE 1 END,
               confidence DESC NULLS LAST, skill_label
    `;
    const applications = await this.database.sql`
      SELECT
        a.id::text,
        a.job_id::text,
        j.title AS job_title,
        a.status,
        a.pipeline_stage,
        a.source,
        a.pre_interview_match_score,
        latest_scorecard.id::text AS scorecard_id,
        latest_scorecard.overall_score,
        latest_scorecard.recommendation,
        latest_decision.decision,
        latest_decision.reason AS decision_reason
      FROM applications a
      JOIN jobs j ON j.organization_id = a.organization_id AND j.id = a.job_id
      LEFT JOIN LATERAL (
        SELECT s.id, s.overall_score, s.recommendation
        FROM scorecards s
        WHERE s.organization_id = a.organization_id AND s.application_id = a.id
        ORDER BY s.created_at DESC
        LIMIT 1
      ) latest_scorecard ON true
      LEFT JOIN LATERAL (
        SELECT d.decision, d.reason
        FROM hiring_decisions d
        WHERE d.organization_id = a.organization_id AND d.application_id = a.id
        ORDER BY d.created_at DESC
        LIMIT 1
      ) latest_decision ON true
      WHERE a.organization_id = ${organizationId}::uuid AND a.candidate_id = ${candidateId}::uuid
      ORDER BY a.updated_at DESC
    `;
    const evidence = await this.database.sql`
      SELECT id::text, application_id::text, evidence_type, source_type, source_reference,
             excerpt, occurred_at, created_at
      FROM evidence
      WHERE organization_id = ${organizationId}::uuid AND candidate_id = ${candidateId}::uuid
      ORDER BY created_at DESC
      LIMIT 200
    `;

    // Resume evidence is an unverified assertion, never an interview score.
    const resumeSkillClaims = await this.database.sql`
      SELECT rc.id::text, rc.resume_id::text, rc.evidence_id::text, rc.source_reference,
             rc.claim_text, rc.start_char, rc.end_char, rc.extraction_confidence,
             rc.review_state, rc.taxonomy_version, rc.parser_version,
             st.skill_key, st.name_en, st.name_fa, r.original_filename
      FROM resume_skill_claims rc
      JOIN skill_taxonomy st
        ON st.organization_id = rc.organization_id AND st.id = rc.skill_id
      JOIN resumes r
        ON r.organization_id = rc.organization_id AND r.candidate_id = rc.candidate_id
       AND r.id = rc.resume_id
      WHERE rc.organization_id = ${organizationId}::uuid
        AND rc.candidate_id = ${candidateId}::uuid
      ORDER BY rc.created_at DESC, rc.id DESC
      LIMIT 200
    `;
    const jobSkillRequirements = await this.database.sql`
      SELECT a.id::text AS application_id, jsr.required_level, jsr.weight, jsr.required,
             jsr.minimum_evidence_count, jsr.requirement_version, st.skill_key, st.name_en, st.name_fa
      FROM applications a
      JOIN LATERAL (
        SELECT DISTINCT ON (skill_id) *
        FROM job_skill_requirements
        WHERE organization_id = a.organization_id AND job_id = a.job_id
        ORDER BY skill_id, requirement_version DESC, created_at DESC
      ) jsr ON true
      JOIN skill_taxonomy st ON st.organization_id = jsr.organization_id AND st.id = jsr.skill_id
      WHERE a.organization_id = ${organizationId}::uuid AND a.candidate_id = ${candidateId}::uuid
      ORDER BY a.id, jsr.required DESC, jsr.weight DESC
      LIMIT 300
    `;

    const candidate = candidates[0];
    return {
      candidate: {
        id: String(candidate.id),
        displayName: String(candidate.display_name),
        ...(candidate.primary_email ? { primaryEmail: String(candidate.primary_email) } : {}),
        ...(candidate.primary_phone ? { primaryPhone: String(candidate.primary_phone) } : {}),
        ...(candidate.current_role ? { currentRole: String(candidate.current_role) } : {}),
        ...(candidate.current_company ? { currentCompany: String(candidate.current_company) } : {}),
        ...(candidate.location ? { location: String(candidate.location) } : {}),
        ...(candidate.preferred_language ? { preferredLanguage: String(candidate.preferred_language) } : {}),
      },
      experiences: experiences.map((row) => ({
        id: String(row.id),
        company: String(row.company),
        title: String(row.title),
        ...(row.started_on ? { startedOn: String(row.started_on) } : {}),
        ...(row.ended_on ? { endedOn: String(row.ended_on) } : {}),
        ...(row.description ? { description: String(row.description) } : {}),
        ...(row.source_reference ? { sourceReference: String(row.source_reference) } : {}),
      })),
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
        ...(row.pre_interview_match_score !== null ? { preInterviewMatchScore: Number(row.pre_interview_match_score) } : {}),
        ...(row.scorecard_id ? { scorecardId: String(row.scorecard_id) } : {}),
        ...(row.overall_score !== null ? { hiringScore: Number(row.overall_score) } : {}),
        ...(row.recommendation ? { recommendation: String(row.recommendation) } : {}),
        ...(row.decision ? { decision: String(row.decision) } : {}),
        ...(row.decision_reason ? { decisionReason: String(row.decision_reason) } : {}),
      })),
      resumeSkillClaims: resumeSkillClaims.map((row) => ({
        id: String(row.id),
        resumeId: String(row.resume_id),
        ...(row.evidence_id ? { evidenceId: String(row.evidence_id) } : {}),
        skillKey: String(row.skill_key),
        skillName: String(row.name_fa || row.name_en),
        originalFilename: String(row.original_filename),
        claimText: String(row.claim_text),
        startChar: Number(row.start_char),
        endChar: Number(row.end_char),
        confidence: Number(row.extraction_confidence),
        reviewState: String(row.review_state),
        parserVersion: String(row.parser_version),
        taxonomyVersion: String(row.taxonomy_version),
        sourceReference: String(row.source_reference),
      })),
      jobSkillRequirements: jobSkillRequirements.map((row) => ({
        applicationId: String(row.application_id),
        skillKey: String(row.skill_key),
        skillName: String(row.name_fa || row.name_en),
        requiredLevel: Number(row.required_level),
        importance: Number(row.weight),
        required: Boolean(row.required),
        minimumEvidenceCount: Number(row.minimum_evidence_count),
        requirementVersion: Number(row.requirement_version),
      })),
      evidence: evidence.map((row) => ({
        id: String(row.id),
        ...(row.application_id ? { applicationId: String(row.application_id) } : {}),
        evidenceType: String(row.evidence_type),
        sourceType: String(row.source_type),
        sourceReference: String(row.source_reference),
        ...(row.excerpt ? { excerpt: String(row.excerpt) } : {}),
        ...(row.occurred_at ? { occurredAt: new Date(String(row.occurred_at)).toISOString() } : {}),
        createdAt: new Date(String(row.created_at)).toISOString(),
      })),
    };
  }
}
