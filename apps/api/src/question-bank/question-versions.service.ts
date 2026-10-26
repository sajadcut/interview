import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type { CreateBankQuestionDto, ReviseBankQuestionDto, ReviewBankQuestionDto } from "./question-versions.dto";

function present(row: Record<string, unknown>) {
  return {
    id: String(row.id), jobId: String(row.job_id), documentId: String(row.document_id),
    versionId: String(row.version_id), version: Number(row.version),
    questionText: String(row.question_text), sourceExcerpt: String(row.source_excerpt),
    ...(row.skill_key ? { skillKey: String(row.skill_key) } : {}),
    reviewState: String(row.review_state), origin: String(row.origin),
  };
}

@Injectable()
export class QuestionVersionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenant: TenantContextService,
    private readonly auth: AuthContextService,
  ) {}

  private actor() {
    const id = this.auth.getOptional()?.userId;
    if (!id) throw new UnauthorizedException("Authenticated human reviewer required");
    return id;
  }

  async list(jobId: string) {
    const organizationId = this.tenant.require().organizationId;
    const job = await this.database.sql`SELECT id FROM jobs WHERE organization_id=${organizationId}::uuid
      AND id=${jobId}::uuid AND status <> 'deleted'`;
    if (!job[0]) throw new NotFoundException("Job not found");
    const rows = await this.database.sql`
      SELECT q.id::text,q.job_id::text,q.document_id::text,q.origin,
        v.id::text AS version_id,v.version,v.question_text,v.source_excerpt,
        st.skill_key,COALESCE(r.decision,'pending') AS review_state
      FROM question_bank_questions q
      JOIN LATERAL (
        SELECT * FROM question_bank_question_versions
        WHERE organization_id=q.organization_id AND question_id=q.id
        ORDER BY version DESC LIMIT 1
      ) v ON true
      LEFT JOIN question_bank_question_reviews r
        ON r.organization_id=v.organization_id AND r.version_id=v.id
      LEFT JOIN skill_taxonomy st
        ON st.organization_id=v.organization_id AND st.id=v.skill_id
      WHERE q.organization_id=${organizationId}::uuid AND q.job_id=${jobId}::uuid
      ORDER BY q.created_at DESC,q.id DESC LIMIT 500
    `;
    return rows.map(present);
  }

  private validateInput(input: CreateBankQuestionDto) {
    if (!input.questionText || input.questionText.trim().length < 12 || input.questionText.length > 600 ||
        !input.sourceExcerpt || input.sourceExcerpt.trim().length < 12 || input.sourceExcerpt.length > 600) {
      throw new BadRequestException("A sourced question and a literal excerpt (12-600 characters) are required");
    }
    // Markup in a reference document is untrusted data; it must never be silently executed.
    if (/[\u0000-\u001f]/u.test(input.questionText.replace(/\n/g, ""))) {
      throw new BadRequestException("Question contains invalid control characters");
    }
  }

  async create(jobId: string, input: CreateBankQuestionDto) {
    this.validateInput(input);
    const organizationId = this.tenant.require().organizationId;
    const actor = this.actor();
    await this.database.sql.begin(async tx => {
      const document = await tx`
        SELECT id, extracted_text FROM question_bank_documents
        WHERE organization_id=${organizationId}::uuid
          AND job_id=${jobId}::uuid AND id=${input.documentId}::uuid
      `;
      if (!document[0]) throw new NotFoundException("Job question document not found");
      if (!String(document[0].extracted_text).includes(input.sourceExcerpt)) {
        throw new BadRequestException("Source excerpt must occur literally in the original job document");
      }
      const skill = input.skillKey ? await tx`
        SELECT id::text FROM skill_taxonomy
        WHERE organization_id=${organizationId}::uuid AND skill_key=${input.skillKey}
      ` : [];
      if (input.skillKey && !skill[0]) throw new BadRequestException("Unknown organization taxonomy skill");
      const created = await tx`
        INSERT INTO question_bank_questions(
          organization_id,job_id,document_id,origin,created_by_user_id
        ) VALUES (
          ${organizationId}::uuid,${jobId}::uuid,${input.documentId}::uuid,
          'manual',${actor}::uuid
        ) RETURNING id
      `;
      await tx`
        INSERT INTO question_bank_question_versions(
          organization_id,question_id,version,question_text,source_excerpt,skill_id,created_by_user_id
        ) VALUES (
          ${organizationId}::uuid,${String(created[0]!.id)}::uuid,1,
          ${input.questionText.trim()},${input.sourceExcerpt},
          ${skill[0] ? String(skill[0].id) : null}::uuid,${actor}::uuid
        )
      `;
    });
    return this.list(jobId);
  }

  async revise(jobId: string, questionId: string, input: ReviseBankQuestionDto) {
    this.validateInput({ ...input, documentId: "00000000-0000-4000-8000-000000000000" });
    const organizationId = this.tenant.require().organizationId;
    const actor = this.actor();
    await this.database.sql.begin(async tx => {
      const question = await tx`
        SELECT q.id, q.document_id, d.extracted_text
        FROM question_bank_questions q
        JOIN question_bank_documents d ON d.organization_id=q.organization_id
          AND d.job_id=q.job_id AND d.id=q.document_id
        WHERE q.organization_id=${organizationId}::uuid AND q.job_id=${jobId}::uuid
          AND q.id=${questionId}::uuid FOR UPDATE OF q
      `;
      if (!question[0]) throw new NotFoundException("Question not found");
      if (!String(question[0].extracted_text).includes(input.sourceExcerpt))
        throw new BadRequestException("Source excerpt does not occur in the document");
      const prior = await tx`
        SELECT version FROM question_bank_question_versions
        WHERE organization_id=${organizationId}::uuid AND question_id=${questionId}::uuid
        ORDER BY version DESC LIMIT 1
      `;
      if (Number(prior[0]?.version) !== input.expectedVersion)
        throw new ConflictException("Question version changed; reload before editing");
      const skill = input.skillKey ? await tx`
        SELECT id::text FROM skill_taxonomy
        WHERE organization_id=${organizationId}::uuid AND skill_key=${input.skillKey}
      ` : [];
      if (input.skillKey && !skill[0]) throw new BadRequestException("Unknown taxonomy skill");
      await tx`
        INSERT INTO question_bank_question_versions(
          organization_id,question_id,version,question_text,source_excerpt,skill_id,created_by_user_id
        ) VALUES (
          ${organizationId}::uuid,${questionId}::uuid,${input.expectedVersion+1},
          ${input.questionText.trim()},${input.sourceExcerpt},
          ${skill[0] ? String(skill[0].id) : null}::uuid,${actor}::uuid
        )
      `;
    });
    return this.list(jobId);
  }

  async review(jobId: string, questionId: string, input: ReviewBankQuestionDto) {
    const organizationId = this.tenant.require().organizationId;
    const actor = this.actor();
    const reason = input.reason?.trim() ?? "";
    if (!["approved","rejected"].includes(input.decision) || reason.length < 8 || reason.length > 1000 ||
        !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new BadRequestException("Invalid question review decision, reason or version");
    }
    await this.database.sql.begin(async tx => {
      const question = await tx`
        SELECT id FROM question_bank_questions WHERE organization_id=${organizationId}::uuid
          AND job_id=${jobId}::uuid AND id=${questionId}::uuid FOR UPDATE
      `;
      if (!question[0]) throw new NotFoundException("Question not found");
      const versions = await tx`
        SELECT v.id::text,v.version,v.skill_id,r.id AS previous_review
        FROM question_bank_question_versions v
        LEFT JOIN question_bank_question_reviews r
          ON r.organization_id=v.organization_id AND r.version_id=v.id
        WHERE v.organization_id=${organizationId}::uuid AND v.question_id=${questionId}::uuid
        ORDER BY v.version DESC LIMIT 1
      `;
      const version = versions[0];
      if (!version || Number(version.version) !== input.expectedVersion || version.previous_review)
        throw new ConflictException("Question version was changed or already reviewed");
      if (input.decision === "approved" && !version.skill_id)
        throw new BadRequestException("Approved question must be mapped to a canonical skill");
      await tx`
        INSERT INTO question_bank_question_reviews(
          organization_id,version_id,decision,reason,reviewer_user_id
        ) VALUES (${organizationId}::uuid,${String(version.id)}::uuid,${input.decision},
          ${reason},${actor}::uuid)
      `;
    });
    return { questionId, version: input.expectedVersion, decision: input.decision, reviewerUserId: actor };
  }
}
