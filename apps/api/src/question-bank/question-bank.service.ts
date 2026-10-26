import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { StorageService } from "../storage/storage.service";
import { ResumeTextExtractor, MAX_RESUME_BYTES } from "../resumes/resume-text-extractor";
import { getEnv } from "../config/env";

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
          byte_size, sha256, extracted_text
        ) VALUES (
          ${organizationId}::uuid, ${jobId}::uuid, ${saved.id}::uuid,
          ${fileName}, ${mimeType}, ${file.size}, ${saved.sha256}, ${body}
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
      return { applicationId, documentIds: ids };
    });
  }
}
