import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { QuestionProposalProvider } from "./question-proposal-provider";
import { MAX_QUESTION_PROPOSAL_SOURCE_CHARS, validateQuestionProposals } from "./question-proposal-validation";
import type { GenerateBankQuestionProposalsDto, GenerateBankQuestionProposalsResponseDto } from "./question-proposals.dto";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

@Injectable()
export class QuestionProposalsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenant: TenantContextService,
    private readonly auth: AuthContextService,
    private readonly provider: QuestionProposalProvider,
  ) {}

  /** Never invoked on upload. HR explicitly opts in per document and job. */
  async generate(jobId: string, input: GenerateBankQuestionProposalsDto): Promise<GenerateBankQuestionProposalsResponseDto> {
    if (input.consentToRemoteProcessing !== true)
      throw new BadRequestException("Explicit consent for remote document processing is required");
    const actor = this.auth.getOptional()?.userId;
    if (!actor) throw new UnauthorizedException("Authenticated human reviewer required");
    const organizationId = this.tenant.require().organizationId;
    const rows = await this.database.sql`
      SELECT d.id::text,d.extracted_text,d.sha256
      FROM question_bank_documents d
      JOIN jobs j ON j.organization_id=d.organization_id AND j.id=d.job_id AND j.status <> 'deleted'
      WHERE d.organization_id=${organizationId}::uuid AND d.job_id=${jobId}::uuid
        AND d.id=${input.documentId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException("Question document not found for this job");
    const sourceText = String(rows[0].extracted_text);
    const documentSha = String(rows[0].sha256);
    const sourceSha = sha256(sourceText);
    const bounded = sourceText.slice(0, MAX_QUESTION_PROPOSAL_SOURCE_CHARS);
    if (bounded.trim().length < 40)
      throw new BadRequestException("Document must have at least 40 extracted text characters");

    // Only current, active job requirements can appear in proposed questions.
    const skills = await this.database.sql`
      SELECT st.id::text, st.skill_key
      FROM job_skill_requirements req
      JOIN skill_taxonomy st ON st.organization_id=req.organization_id AND st.id=req.skill_id
      WHERE req.organization_id=${organizationId}::uuid AND req.job_id=${jobId}::uuid
        AND req.is_active=true AND req.requirement_version=(
          SELECT MAX(latest.requirement_version) FROM job_skill_requirements latest
          WHERE latest.organization_id=req.organization_id AND latest.job_id=req.job_id
            AND latest.skill_id=req.skill_id
        )
      ORDER BY st.skill_key LIMIT 32
    `;
    if (!skills.length) return { status: "no_job_skills", persistedCount: 0 };
    const allowed = skills.map(row => String(row.skill_key));
    const response = await this.provider.propose({ sourceText: bounded, skillKeys: allowed });
    if (response.status !== "ok") return { status: response.status, persistedCount: 0 };

    let accepted;
    try {
      accepted = validateQuestionProposals(response.output, bounded, allowed);
    } catch {
      return { status: "invalid_output", persistedCount: 0 };
    }
    let persistedCount = 0;
    await this.database.sql.begin(async tx => {
      const current = await tx`
        SELECT extracted_text,sha256 FROM question_bank_documents
        WHERE organization_id=${organizationId}::uuid AND job_id=${jobId}::uuid
          AND id=${input.documentId}::uuid FOR UPDATE
      `;
      if (!current[0] || sha256(String(current[0].extracted_text)) !== sourceSha ||
          String(current[0].sha256) !== documentSha)
        throw new ConflictException("Source document changed; regenerate proposals");

      for (const item of accepted) {
        const skill = skills.find(row => String(row.skill_key) === item.skillKey);
        if (!skill) continue;
        const normalizedQuestion = item.questionText.trim();
        const questionSha = sha256(normalizedQuestion.toLocaleLowerCase());
        const existing = await tx`
          SELECT id FROM question_bank_llm_provenance
          WHERE organization_id=${organizationId}::uuid AND document_id=${input.documentId}::uuid
            AND source_text_sha256=${sourceSha} AND skill_id=${String(skill.id)}::uuid
            AND question_sha256=${questionSha}
          LIMIT 1
        `;
        if (existing.length) continue;
        const created = await tx`
          INSERT INTO question_bank_questions(organization_id,job_id,document_id,origin,created_by_user_id)
          VALUES (${organizationId}::uuid,${jobId}::uuid,${input.documentId}::uuid,
            'llm_proposed',${actor}::uuid) RETURNING id
        `;
        const version = await tx`
          INSERT INTO question_bank_question_versions(
            organization_id,question_id,version,question_text,source_excerpt,skill_id,created_by_user_id
          ) VALUES (${organizationId}::uuid,${String(created[0]!.id)}::uuid,1,
            ${normalizedQuestion},${item.sourceExcerpt},${String(skill.id)}::uuid,${actor}::uuid)
          RETURNING id
        `;
        await tx`
          INSERT INTO question_bank_llm_provenance(
            organization_id,document_id,version_id,skill_id,source_text_sha256,document_sha256,
            question_sha256,start_char,end_char,confidence,provider,model,requested_by_user_id
          ) VALUES (
            ${organizationId}::uuid,${input.documentId}::uuid,${String(version[0]!.id)}::uuid,
            ${String(skill.id)}::uuid,${sourceSha},${documentSha},${questionSha},
            ${item.startChar},${item.endChar},${item.confidence},
            ${response.provider.slice(0,80)},${response.model.slice(0,160)},${actor}::uuid
          )
        `;
        persistedCount++;
      }
    });
    return { status: "ok", persistedCount };
  }
}
