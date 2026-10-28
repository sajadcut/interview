import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { StorageService } from "../storage/storage.service";
import { ResumeTextExtractor, MAX_RESUME_BYTES } from "../resumes/resume-text-extractor";
import { getEnv } from "../config/env";
import { extractQuestionCandidates } from "./question-bank-questions";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
};
const MAX_DOCUMENTS_PER_JOB = 50;
const MAX_EXTRACT_CHARS = 40_000;

type DocumentRow = Record<string, unknown>;
function present(row: DocumentRow) {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    fileName: String(row.original_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.byte_size),
    sha256: String(row.sha256),
    createdAt: new Date(String(row.created_at)).toISOString(),
    preview: String(row.extracted_text ?? "").slice(0, 320),
  };
}

@Injectable()
export class QuestionBankService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenant: TenantContextService,
    private readonly storage: StorageService,
    private readonly extractor: ResumeTextExtractor,
  ) {}

  async jobs() {
    const organizationId = this.tenant.require().organizationId;
    const rows = await this.database.sql`
      SELECT id::text, title FROM jobs
      WHERE organization_id=${organizationId}::uuid
        AND status NOT IN ('deleted')
      ORDER BY created_at DESC LIMIT 200
    `;
    return rows.map((row) => ({ id: String(row.id), title: String(row.title) }));
  }

  private async requireJob(jobId: string) {
    const organizationId = this.tenant.require().organizationId;
    const rows = await this.database.sql`
      SELECT id FROM jobs WHERE organization_id=${organizationId}::uuid AND id=${jobId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException("Job not found");
  }

  async list(jobId: string) {
    await this.requireJob(jobId);
    const organizationId = this.tenant.require().organizationId;
    const rows = await this.database.sql`
      SELECT id::text, job_id::text, original_name, mime_type, byte_size,
             sha256, extracted_text, created_at
      FROM question_bank_documents
      WHERE organization_id=${organizationId}::uuid AND job_id=${jobId}::uuid
      ORDER BY created_at DESC
    `;
    return rows.map((row) => present(row));
  }

  async upload(jobId: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    await this.requireJob(jobId);
    if (!file?.buffer || file.size === 0 || file.size > MAX_RESUME_BYTES)
      throw new BadRequestException("File must be between 1 byte and 10 MB");
    const fileName = file.originalname.trim().slice(0, 255);
    const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
    const mimeType = MIME_BY_EXTENSION[extension];
    if (!mimeType || (file.mimetype !== mimeType && !(extension === ".txt" && file.mimetype === "application/octet-stream")))
      throw new BadRequestException("Only matching PDF, DOCX and UTF-8 TXT files are allowed");
    if (getEnv().STORAGE_PROVIDER !== "local")
      throw new BadRequestException("The question bank requires local disk storage (STORAGE_PROVIDER=local)");
    // Extract before writing: corrupt, image-only and unsupported files never enter the bank.
    const extracted = await this.extractor.extract({ data: file.buffer, mimeType, originalName: fileName });
    const body = extracted.text.slice(0, MAX_EXTRACT_CHARS);
    const questions = extractQuestionCandidates(body);
    const organizationId = this.tenant.require().organizationId;
    const count = await this.database.sql`
      SELECT count(*)::int AS count FROM question_bank_documents
      WHERE organization_id=${organizationId}::uuid AND job_id=${jobId}::uuid
    `;
    if (Number(count[0]?.count ?? 0) >= MAX_DOCUMENTS_PER_JOB)
      throw new BadRequestException("Maximum 50 documents per job");
    const saved = await this.storage.save({ originalName: fileName, mimeType, data: file.buffer });
    try {
      const rows = await this.database.sql`
        INSERT INTO question_bank_documents (
          organization_id, job_id, file_id, original_name, mime_type,
          byte_size, sha256, extracted_text, suggested_questions
        ) VALUES (
          ${organizationId}::uuid, ${jobId}::uuid, ${saved.id}::uuid,
          ${fileName}, ${mimeType}, ${file.size}, ${saved.sha256}, ${body},
          ${this.database.sql.json(questions as never)}
        )
        RETURNING id::text, job_id::text, original_name, mime_type, byte_size,
                  sha256, extracted_text, created_at
      `;
      return present(rows[0]!);
    } catch (error) {
      await this.storage.deleteById(saved.id).catch(() => undefined);
      throw error;
    }
  }

  private async application(applicationId: string) {
    const organizationId = this.tenant.require().organizationId;
    const rows = await this.database.sql`
      SELECT id::text, job_id::text FROM applications
      WHERE organization_id=${organizationId}::uuid AND id=${applicationId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException("Application not found");
    return { id: String(rows[0].id), jobId: String(rows[0].job_id) };
  }

  private async locked(applicationId: string) {
    const organizationId = this.tenant.require().organizationId;
    const rows = await this.database.sql`
      SELECT 1 FROM interview_sessions
      WHERE organization_id=${organizationId}::uuid AND application_id=${applicationId}::uuid
        AND status NOT IN ('cancelled', 'failed') LIMIT 1
    `;
    return Boolean(rows[0]);
  }

  async selection(applicationId: string) {
    const application = await this.application(applicationId);
    const organizationId = this.tenant.require().organizationId;
    const [selected, availableDocuments, locked] = await Promise.all([
      this.database.sql`
        SELECT document_id::text FROM application_question_documents
        WHERE organization_id=${organizationId}::uuid AND application_id=${applicationId}::uuid
      `,
      this.list(application.jobId),
      this.locked(applicationId),
    ]);
    return {
      applicationId,
      jobId: application.jobId,
      availableDocuments,
      selectedDocumentIds: selected.map((row) => String(row.document_id)),
      locked,
    };
  }

  async saveSelection(applicationId: string, documentIds: string[]) {
    const ids = [...new Set(documentIds)];
    if (ids.length !== documentIds.length || ids.length > 8)
      throw new BadRequestException("Select at most eight unique documents");
    const organizationId = this.tenant.require().organizationId;
    // Lock the application row to serialize competing HR selection updates.
    return this.database.sql.begin(async (tx) => {
      const applications = await tx`
        SELECT job_id::text FROM applications
        WHERE organization_id=${organizationId}::uuid AND id=${applicationId}::uuid
        FOR UPDATE
      `;
      if (!applications[0]) throw new NotFoundException("Application not found");
      const sessions = await tx`
        SELECT id FROM interview_sessions
        WHERE organization_id=${organizationId}::uuid AND application_id=${applicationId}::uuid
          AND status NOT IN ('cancelled', 'failed') LIMIT 1
      `;
      if (sessions[0]) throw new ConflictException("Document selection is locked after interview starts");
      for (const id of ids) {
        const matches = await tx`
          SELECT id FROM question_bank_documents
          WHERE organization_id=${organizationId}::uuid
            AND job_id=${String(applications[0].job_id)}::uuid
            AND id=${id}::uuid
        `;
        if (!matches[0]) throw new BadRequestException("Selected document does not belong to the candidate job");
      }
      await tx`
        DELETE FROM application_question_documents
        WHERE organization_id=${organizationId}::uuid AND application_id=${applicationId}::uuid
      `;
      for (const id of ids) {
        await tx`
          INSERT INTO application_question_documents (organization_id, application_id, document_id)
          VALUES (${organizationId}::uuid, ${applicationId}::uuid, ${id}::uuid)
        `;
      }
      // Freeze the selected source identities AND approved immutable question
      // versions. Later edits/approvals do not rewrite earlier snapshots.
      const approved = await tx`
        SELECT q.id::text AS question_id,q.document_id::text,v.id::text AS version_id,
               v.version,v.question_text,v.source_excerpt,st.skill_key,
               d.sha256 AS document_sha256,q.origin,
               prov.source_text_sha256 AS model_source_sha256,
               prov.start_char AS model_start_char,prov.end_char AS model_end_char,
               prov.provider AS model_provider,prov.model AS model_name
        FROM application_question_documents selected
        JOIN question_bank_questions q
          ON q.organization_id=selected.organization_id
         AND q.document_id=selected.document_id
        JOIN question_bank_documents d
          ON d.organization_id=q.organization_id AND d.job_id=q.job_id AND d.id=q.document_id
        JOIN LATERAL (
          SELECT * FROM question_bank_question_versions vv
          WHERE vv.organization_id=q.organization_id AND vv.question_id=q.id
          ORDER BY vv.version DESC LIMIT 1
        ) v ON true
        JOIN question_bank_question_reviews review
          ON review.organization_id=v.organization_id AND review.version_id=v.id
         AND review.decision='approved'
        JOIN LATERAL (
          SELECT r.is_active FROM job_skill_requirements r
          WHERE r.organization_id=v.organization_id AND r.job_id=q.job_id
            AND r.skill_id=v.skill_id
          ORDER BY r.requirement_version DESC LIMIT 1
        ) current_skill ON current_skill.is_active=true
        LEFT JOIN skill_taxonomy st
          ON st.organization_id=v.organization_id AND st.id=v.skill_id
        LEFT JOIN question_bank_llm_provenance prov
          ON prov.organization_id=v.organization_id AND prov.version_id=v.id
        WHERE selected.organization_id=${organizationId}::uuid
          AND selected.application_id=${applicationId}::uuid
          AND q.job_id=${String(applications[0].job_id)}::uuid
        ORDER BY q.document_id,q.id,v.version
      `;
      const frozenQuestions = approved.map(row => ({
        questionId: String(row.question_id),
        documentId: String(row.document_id),
        documentSha256: String(row.document_sha256),
        versionId: String(row.version_id),
        version: Number(row.version),
        questionText: String(row.question_text),
        sourceExcerpt: String(row.source_excerpt),
        origin: String(row.origin),
        ...(row.model_source_sha256 ? { modelProvenance: {
          sourceTextSha256: String(row.model_source_sha256),
          startChar: Number(row.model_start_char), endChar: Number(row.model_end_char),
          provider: String(row.model_provider), model: String(row.model_name),
        } } : {}),
        ...(row.skill_key ? { skillKey: String(row.skill_key) } : {}),
      }));
      const frozen = { documentIds: ids, approvedQuestionVersions: frozenQuestions };
      const contentSha = createHash("sha256").update(JSON.stringify(frozen)).digest("hex");
      const previous = await tx`
        SELECT snapshot_version FROM application_question_selection_snapshots
        WHERE organization_id=${organizationId}::uuid AND application_id=${applicationId}::uuid
        ORDER BY snapshot_version DESC LIMIT 1
      `;
      const snapshotVersion = Number(previous[0]?.snapshot_version ?? 0) + 1;
      await tx`
        INSERT INTO application_question_selection_snapshots(
          organization_id,application_id,job_id,snapshot_version,
          document_ids,approved_question_versions,content_sha256
        ) VALUES (
          ${organizationId}::uuid,${applicationId}::uuid,
          ${String(applications[0].job_id)}::uuid,${snapshotVersion},
          ${tx.json(ids)},${tx.json(frozenQuestions)},${contentSha}
        )
      `;
      return { applicationId, documentIds: ids, snapshotVersion, snapshotSha256: contentSha };
    });
  }

  async selectionSnapshots(applicationId: string) {
    await this.application(applicationId);
    const organizationId = this.tenant.require().organizationId;
    const rows = await this.database.sql`
      SELECT id::text,snapshot_version,document_ids,approved_question_versions,
             content_sha256,created_at
      FROM application_question_selection_snapshots
      WHERE organization_id=${organizationId}::uuid AND application_id=${applicationId}::uuid
      ORDER BY snapshot_version DESC LIMIT 100
    `;
    return rows.map(row => ({
      id: String(row.id), applicationId,
      snapshotVersion: Number(row.snapshot_version),
      documentIds: row.document_ids,
      approvedQuestionVersions: row.approved_question_versions,
      contentSha256: String(row.content_sha256),
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
  }
}
