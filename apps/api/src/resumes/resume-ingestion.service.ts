import { createHash } from "node:crypto";
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { StorageService } from "../storage/storage.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { ResumeChunker, type ResumeChunk } from "./resume-chunker";
import { RESUME_EMBEDDING_PROVIDER, type ResumeEmbeddingBatch, type ResumeEmbeddingProvider } from "./resume-embedding-provider";
import { ResumeParser, type ParsedResumeProfile } from "./resume-parser";
import { MAX_RESUME_BYTES, ResumeTextExtractor } from "./resume-text-extractor";
import type { ResumeDto } from "./resume-ingestion.dto";

export interface ResumeUpload {
  originalName: string;
  mimeType: string;
  data: Uint8Array;
}

type ResumeRow = {
  id: string;
  candidate_id: string;
  application_id: string | null;
  file_id: string;
  status: string;
  original_filename: string;
  content_type: string;
  byte_size: string | number;
  sha256: string;
  structured_profile: unknown;
  failure_code: string | null;
  failure_message: string | null;
  processed_at: Date | string | null;
  created_at: Date | string;
  page_count: number | null;
  chunk_count: string | number;
  embedded_chunk_count: string | number;
  evidence_count: string | number;
};

@Injectable()
export class ResumeIngestionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly storage: StorageService,
    private readonly extractor: ResumeTextExtractor,
    private readonly parser: ResumeParser,
    private readonly chunker: ResumeChunker,
    @Inject(RESUME_EMBEDDING_PROVIDER) private readonly embeddings: ResumeEmbeddingProvider,
  ) {}

  async ingest(candidateId: string, upload: ResumeUpload, applicationId?: string): Promise<ResumeDto> {
    const organizationId = this.tenantContext.require().organizationId;
    if (upload.data.byteLength === 0 || upload.data.byteLength > MAX_RESUME_BYTES) {
      throw new BadRequestException("Resume must be between 1 byte and 10 MB");
    }
    await this.assertCandidateContext(organizationId, candidateId, applicationId);

    const sha256 = createHash("sha256").update(upload.data).digest("hex");
    const existing = await this.findByHash(organizationId, candidateId, sha256);
    if (existing) return this.getResume(candidateId, existing.id);

    const saved = await this.storage.save({
      originalName: upload.originalName,
      mimeType: upload.mimeType,
      data: upload.data,
    });

    const inserted = await this.database.sql`
      INSERT INTO resumes (
        organization_id, candidate_id, application_id, file_id, status,
        original_filename, content_type, byte_size, sha256
      ) VALUES (
        ${organizationId}::uuid,
        ${candidateId}::uuid,
        ${applicationId ?? null}::uuid,
        ${saved.id}::uuid,
        'uploaded',
        ${upload.originalName},
        ${upload.mimeType},
        ${upload.data.byteLength},
        ${sha256}
      )
      ON CONFLICT (organization_id, candidate_id, sha256) DO NOTHING
      RETURNING id
    `;
    const resumeId = (inserted[0] as { id?: string } | undefined)?.id;
    if (!resumeId) {
      await this.storage.deleteById(saved.id);
      const raced = await this.findByHash(organizationId, candidateId, sha256);
      if (!raced) throw new Error("Resume idempotency conflict could not be resolved");
      return this.getResume(candidateId, raced.id);
    }

    try {
      await this.database.sql`
        UPDATE resumes SET status = 'extracting', updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${resumeId}::uuid
      `;
      const extracted = await this.extractor.extract({
        data: upload.data,
        mimeType: upload.mimeType,
        originalName: upload.originalName,
      });

      await this.database.sql`
        UPDATE resumes SET status = 'parsing', extractor_version = ${extracted.extractorVersion}, updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${resumeId}::uuid
      `;
      const profile = this.parser.parse(extracted.text);
      const chunks = this.chunker.chunk(extracted.text);
      if (chunks.length === 0) throw new UnprocessableEntityException("Resume produced no searchable chunks");
      const embeddingBatch = await this.embedChunks(chunks);

      await this.persistProcessedResume({
        organizationId,
        candidateId,
        applicationId: applicationId ?? null,
        resumeId,
        extractedText: extracted.text,
        pageCount: extracted.pageCount,
        extractorVersion: extracted.extractorVersion,
        profile,
        chunks,
        embeddingBatch,
      });
      return this.getResume(candidateId, resumeId);
    } catch (error) {
      await this.markFailed(organizationId, resumeId, error);
      if (error instanceof HttpException) throw error;
      throw new UnprocessableEntityException("Resume processing failed");
    }
  }

  async listResumes(candidateId: string): Promise<ResumeDto[]> {
    const organizationId = this.tenantContext.require().organizationId;
    await this.assertCandidateContext(organizationId, candidateId);
    const rows = await this.resumeRows(organizationId, candidateId);
    return rows.map(mapResumeRow);
  }

  async getResume(candidateId: string, resumeId: string): Promise<ResumeDto> {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.resumeRows(organizationId, candidateId, resumeId);
    const row = rows[0];
    if (!row) throw new NotFoundException("Resume not found");
    return mapResumeRow(row);
  }

  async createReadReference(candidateId: string, resumeId: string): Promise<string> {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT file_id
      FROM resumes
      WHERE organization_id = ${organizationId}::uuid
        AND candidate_id = ${candidateId}::uuid
        AND id = ${resumeId}::uuid
      LIMIT 1
    `;
    const fileId = (rows[0] as { file_id?: string } | undefined)?.file_id;
    if (!fileId) throw new NotFoundException("Resume not found");
    return this.storage.createReadReferenceById(fileId);
  }

  private async assertCandidateContext(
    organizationId: string,
    candidateId: string,
    applicationId?: string,
  ): Promise<void> {
    const candidates = await this.database.sql`
      SELECT id FROM candidates
      WHERE organization_id = ${organizationId}::uuid AND id = ${candidateId}::uuid
      LIMIT 1
    `;
    if (!candidates[0]) throw new NotFoundException("Candidate not found");
    if (!applicationId) return;
    const applications = await this.database.sql`
      SELECT id FROM applications
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${applicationId}::uuid
        AND candidate_id = ${candidateId}::uuid
      LIMIT 1
    `;
    if (!applications[0]) throw new BadRequestException("Application does not belong to candidate");
  }

  private async findByHash(organizationId: string, candidateId: string, sha256: string) {
    const rows = await this.database.sql`
      SELECT id, status FROM resumes
      WHERE organization_id = ${organizationId}::uuid
        AND candidate_id = ${candidateId}::uuid
        AND sha256 = ${sha256}
      LIMIT 1
    `;
    return rows[0] as { id: string; status: string } | undefined;
  }

  private async persistProcessedResume(input: {
    organizationId: string;
    candidateId: string;
    applicationId: string | null;
    resumeId: string;
    extractedText: string;
    pageCount: number | null;
    extractorVersion: string;
    profile: ParsedResumeProfile;
    chunks: ResumeChunk[];
    embeddingBatch: ResumeEmbeddingBatch | null;
  }): Promise<void> {
    const textSha = createHash("sha256").update(input.extractedText).digest("hex");
    await this.database.sql.begin(async (tx) => {
      await tx`
        INSERT INTO resume_documents (
          organization_id, resume_id, text_content, text_sha256, page_count, extractor_version
        ) VALUES (
          ${input.organizationId}::uuid, ${input.resumeId}::uuid, ${input.extractedText},
          ${textSha}, ${input.pageCount}, ${input.extractorVersion}
        )
      `;

      const persistedChunks: Array<ResumeChunk & { id: string }> = [];
      for (const chunk of input.chunks) {
        const embeddingVector = input.embeddingBatch?.vectors[chunk.index] ?? null;
        const embeddingMetadata = embeddingVector && input.embeddingBatch
          ? {
              provider: input.embeddingBatch.provider,
              model: input.embeddingBatch.model,
              dimensions: input.embeddingBatch.dimensions,
            }
          : {};
        const rows = await tx`
          INSERT INTO resume_chunks (
            organization_id, resume_id, chunk_index, text_content, content_hash,
            start_char, end_char, embedding_state, embedding_metadata
          ) VALUES (
            ${input.organizationId}::uuid, ${input.resumeId}::uuid, ${chunk.index}, ${chunk.text},
            ${chunk.contentHash}, ${chunk.startChar}, ${chunk.endChar},
            ${embeddingVector ? "completed" : "not_enabled"}, ${JSON.stringify(embeddingMetadata)}::jsonb
          )
          RETURNING id
        `;
        const chunkId = (rows[0] as { id: string }).id;
        persistedChunks.push({ ...chunk, id: chunkId });
        if (embeddingVector && input.embeddingBatch) {
          const serializedVector = JSON.stringify(embeddingVector);
          const vectorSha256 = createHash("sha256").update(serializedVector).digest("hex");
          await tx`
            INSERT INTO resume_chunk_embeddings (
              organization_id, resume_id, chunk_id, provider, model, dimensions, embedding, vector_sha256
            ) VALUES (
              ${input.organizationId}::uuid, ${input.resumeId}::uuid, ${chunkId}::uuid,
              ${input.embeddingBatch.provider}, ${input.embeddingBatch.model}, ${input.embeddingBatch.dimensions},
              ${serializedVector}::jsonb, ${vectorSha256}
            )
          `;
        }
      }

      await tx`
        UPDATE candidates SET
          primary_email = COALESCE(primary_email, ${input.profile.email}),
          primary_phone = COALESCE(primary_phone, ${input.profile.phone}),
          location = COALESCE(location, ${input.profile.location}),
          "current_role" = COALESCE("current_role", ${input.profile.currentRole}),
          current_company = COALESCE(current_company, ${input.profile.currentCompany}),
          preferred_language = COALESCE(preferred_language, ${input.profile.preferredLanguage}),
          updated_at = now()
        WHERE organization_id = ${input.organizationId}::uuid AND id = ${input.candidateId}::uuid
      `;

      if (input.profile.email) {
        await tx`
          INSERT INTO candidate_identities (
            organization_id, candidate_id, identity_type, normalized_value, is_verified, temporary, metadata
          ) VALUES (
            ${input.organizationId}::uuid, ${input.candidateId}::uuid, 'email', ${input.profile.email},
            false, false, ${JSON.stringify({ source: "resume", resumeId: input.resumeId })}::jsonb
          )
          ON CONFLICT (organization_id, identity_type, normalized_value) DO NOTHING
        `;
      }

      for (const skill of input.profile.skills) {
        const sourceReference = `resume:${input.resumeId}#skill:${skill.key}`;
        await tx`
          INSERT INTO candidate_skills (
            organization_id, candidate_id, skill_key, skill_label,
            verification_state, confidence, source_reference
          ) VALUES (
            ${input.organizationId}::uuid, ${input.candidateId}::uuid, ${skill.key}, ${skill.label},
            'unverified', ${skill.confidence}, ${sourceReference}
          )
          ON CONFLICT (candidate_id, skill_key) DO UPDATE SET
            skill_label = EXCLUDED.skill_label,
            confidence = GREATEST(COALESCE(candidate_skills.confidence, 0), EXCLUDED.confidence),
            source_reference = CASE
              WHEN candidate_skills.verification_state = 'unverified' THEN EXCLUDED.source_reference
              ELSE candidate_skills.source_reference
            END
        `;
        const chunk = bestChunk(persistedChunks, skill.label);
        await tx`
          INSERT INTO evidence (
            organization_id, candidate_id, application_id, evidence_type, source_type,
            source_reference, excerpt, metadata
          ) VALUES (
            ${input.organizationId}::uuid, ${input.candidateId}::uuid, ${input.applicationId}::uuid,
            'resume_claim', 'resume', ${sourceReference}, ${chunk?.text.slice(0, 1200) ?? skill.label},
            ${JSON.stringify({ claimType: "skill", skillKey: skill.key, confidence: skill.confidence, resumeId: input.resumeId, chunkId: chunk?.id ?? null, parserVersion: input.profile.parserVersion })}::jsonb
          )
          ON CONFLICT DO NOTHING
        `;
      }

      for (const experience of input.profile.experiences) {
        const sourceReference = `resume:${input.resumeId}#experience:${experience.fingerprint}`;
        await tx`
          INSERT INTO candidate_experiences (
            organization_id, candidate_id, company, title, started_on, ended_on,
            description, source_reference, source_fingerprint
          ) VALUES (
            ${input.organizationId}::uuid, ${input.candidateId}::uuid, ${experience.company}, ${experience.title},
            ${experience.startedOn}::date, ${experience.endedOn}::date, ${experience.description},
            ${sourceReference}, ${experience.fingerprint}
          )
          ON CONFLICT (organization_id, candidate_id, source_fingerprint)
          WHERE source_fingerprint IS NOT NULL DO NOTHING
        `;
        const chunk = bestChunk(persistedChunks, `${experience.title} ${experience.company}`);
        await tx`
          INSERT INTO evidence (
            organization_id, candidate_id, application_id, evidence_type, source_type,
            source_reference, excerpt, metadata
          ) VALUES (
            ${input.organizationId}::uuid, ${input.candidateId}::uuid, ${input.applicationId}::uuid,
            'resume_claim', 'resume', ${sourceReference},
            ${chunk?.text.slice(0, 1200) ?? `${experience.title} — ${experience.company}`},
            ${JSON.stringify({ claimType: "experience", fingerprint: experience.fingerprint, confidence: experience.confidence, resumeId: input.resumeId, chunkId: chunk?.id ?? null, parserVersion: input.profile.parserVersion })}::jsonb
          )
          ON CONFLICT DO NOTHING
        `;
      }

      await tx`
        UPDATE resumes SET
          status = 'completed',
          parser_version = ${input.profile.parserVersion},
          structured_profile = ${JSON.stringify(input.profile)}::jsonb,
          failure_code = NULL,
          failure_message = NULL,
          processed_at = now(),
          updated_at = now()
        WHERE organization_id = ${input.organizationId}::uuid AND id = ${input.resumeId}::uuid
      `;
    });
  }

  private async embedChunks(chunks: ResumeChunk[]): Promise<ResumeEmbeddingBatch | null> {
    if (!this.embeddings.configured) return null;
    const vectors: number[][] = [];
    let provider: string | null = null;
    let model: string | null = null;
    let dimensions: number | null = null;

    for (let offset = 0; offset < chunks.length; offset += 32) {
      const batch = chunks.slice(offset, offset + 32);
      const result = await this.embeddings.embed(batch.map((chunk) => chunk.text));
      if (result.vectors.length !== batch.length || result.dimensions <= 0) {
        throw new UnprocessableEntityException("Embedding provider returned invalid chunk coverage");
      }
      if (result.vectors.some((vector) => vector.length !== result.dimensions || vector.some((value) => !Number.isFinite(value)))) {
        throw new UnprocessableEntityException("Embedding provider returned invalid vector dimensions");
      }
      if (provider === null) {
        provider = result.provider;
        model = result.model;
        dimensions = result.dimensions;
      } else if (provider !== result.provider || model !== result.model || dimensions !== result.dimensions) {
        throw new UnprocessableEntityException("Embedding provider changed model or dimensions within one resume");
      }
      vectors.push(...result.vectors);
    }

    if (!provider || !model || !dimensions || vectors.length !== chunks.length) {
      throw new UnprocessableEntityException("Embedding provider did not cover every resume chunk");
    }
    return { provider, model, dimensions, vectors };
  }

  private async markFailed(organizationId: string, resumeId: string, error: unknown): Promise<void> {
    const code = error instanceof HttpException ? `HTTP_${error.getStatus()}` : "RESUME_PROCESSING_FAILED";
    const message = error instanceof Error ? error.message.slice(0, 500) : "Resume processing failed";
    await this.database.sql`
      UPDATE resumes SET status = 'failed', failure_code = ${code}, failure_message = ${message}, updated_at = now()
      WHERE organization_id = ${organizationId}::uuid AND id = ${resumeId}::uuid
    `;
  }

  private async resumeRows(organizationId: string, candidateId: string, resumeId?: string): Promise<ResumeRow[]> {
    const rows = await this.database.sql`
      SELECT
        r.*,
        d.page_count,
        (SELECT count(*) FROM resume_chunks c WHERE c.organization_id = r.organization_id AND c.resume_id = r.id) AS chunk_count,
        (SELECT count(*) FROM resume_chunk_embeddings ce WHERE ce.organization_id = r.organization_id AND ce.resume_id = r.id) AS embedded_chunk_count,
        (SELECT count(*) FROM evidence e WHERE e.organization_id = r.organization_id AND e.candidate_id = r.candidate_id AND e.source_type = 'resume' AND e.source_reference LIKE ('resume:' || r.id::text || '#%')) AS evidence_count
      FROM resumes r
      LEFT JOIN resume_documents d
        ON d.organization_id = r.organization_id AND d.resume_id = r.id
      WHERE r.organization_id = ${organizationId}::uuid
        AND r.candidate_id = ${candidateId}::uuid
        AND (${resumeId ?? null}::uuid IS NULL OR r.id = ${resumeId ?? null}::uuid)
      ORDER BY r.created_at DESC
    `;
    return rows as unknown as ResumeRow[];
  }
}

function bestChunk(chunks: Array<ResumeChunk & { id: string }>, query: string) {
  const tokens = query.toLowerCase().split(/\s+/).filter((token) => token.length > 2);
  let best: (ResumeChunk & { id: string }) | undefined;
  let score = -1;
  for (const chunk of chunks) {
    const haystack = chunk.text.toLowerCase();
    const current = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
    if (current > score) {
      best = chunk;
      score = current;
    }
  }
  return best;
}

function decodeStructuredProfile(value: unknown): ResumeDto["structuredProfile"] {
  const empty: ResumeDto["structuredProfile"] = {
    email: null,
    phone: null,
    location: null,
    preferredLanguage: null,
    currentRole: null,
    currentCompany: null,
    skills: [],
    experiences: [],
    parserVersion: "",
  };
  if (!value) return empty;
  if (typeof value === "object") return value as ResumeDto["structuredProfile"];
  if (typeof value !== "string") return empty;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? parsed as ResumeDto["structuredProfile"]
      : empty;
  } catch {
    return empty;
  }
}

function mapResumeRow(row: ResumeRow): ResumeDto {
  const profile = decodeStructuredProfile(row.structured_profile);
  return {
    id: row.id,
    candidateId: row.candidate_id,
    applicationId: row.application_id,
    status: row.status,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    pageCount: row.page_count,
    chunkCount: Number(row.chunk_count),
    embeddedChunkCount: Number(row.embedded_chunk_count),
    evidenceCount: Number(row.evidence_count),
    structuredProfile: profile as ResumeDto["structuredProfile"],
    processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
