import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { calculateEvidenceConceptMatch } from "./evidence-match-engine";
import type {
  CandidateMatchRequestDto,
  ResolveDuplicateReviewDto,
  UpsertTalentEntryDto,
} from "./talent-operations.dto";

function currentUserId(auth: AuthContextService): string {
  const userId = auth.getOptional()?.userId;
  if (!userId) throw new BadRequestException("Authenticated user context is required");
  return userId;
}

@Injectable()
export class TalentOperationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
  ) {}

  async upsertTalentEntry(candidateId: string, input: UpsertTalentEntryDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const candidates = await this.database.sql`
      SELECT 1 FROM candidates
      WHERE organization_id = ${organizationId}::uuid AND id = ${candidateId}::uuid
      LIMIT 1
    `;
    if (!candidates[0]) throw new NotFoundException("Candidate not found");
    const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
    const rows = await this.database.sql`
      INSERT INTO talent_pool_entries (organization_id, candidate_id, status, tags, notes)
      VALUES (
        ${organizationId}::uuid,
        ${candidateId}::uuid,
        ${input.status ?? "active"},
        ${tags},
        ${input.notes?.trim() || null}
      )
      ON CONFLICT (organization_id, candidate_id) DO UPDATE
      SET status = COALESCE(${input.status ?? null}, talent_pool_entries.status),
          tags = CASE WHEN ${input.tags !== undefined} THEN EXCLUDED.tags ELSE talent_pool_entries.tags END,
          notes = CASE WHEN ${input.notes !== undefined} THEN EXCLUDED.notes ELSE talent_pool_entries.notes END,
          updated_at = now()
      RETURNING candidate_id::text, status, tags, notes, updated_at
    `;
    return rows[0];
  }

  async scanDuplicates() {
    const organizationId = this.tenantContext.require().organizationId;
    const pairs = await this.database.sql`
      WITH normalized AS (
        SELECT
          id,
          NULLIF(lower(trim(primary_email)), '') AS email,
          NULLIF(regexp_replace(COALESCE(primary_phone, ''), '[^0-9+]', '', 'g'), '') AS phone,
          created_at
        FROM candidates
        WHERE organization_id = ${organizationId}::uuid
      ), pairs AS (
        SELECT
          LEAST(a.id, b.id) AS candidate_a,
          GREATEST(a.id, b.id) AS candidate_b,
          a.email AS a_email,
          b.email AS b_email,
          a.phone AS a_phone,
          b.phone AS b_phone,
          CASE WHEN a.created_at <= b.created_at THEN a.id ELSE b.id END AS canonical_candidate_id,
          CASE WHEN a.created_at <= b.created_at THEN b.id ELSE a.id END AS duplicate_candidate_id
        FROM normalized a
        JOIN normalized b ON a.id < b.id
        WHERE (a.email IS NOT NULL AND a.email = b.email)
           OR (a.phone IS NOT NULL AND a.phone = b.phone)
      )
      SELECT DISTINCT canonical_candidate_id::text, duplicate_candidate_id::text,
             (a_email IS NOT NULL AND a_email = b_email) AS email_match,
             (a_phone IS NOT NULL AND a_phone = b_phone) AS phone_match
      FROM pairs
    `;

    let created = 0;
    for (const pair of pairs) {
      const signals = [
        ...(pair.email_match ? [{ type: "email_exact", strength: "strong" }] : []),
        ...(pair.phone_match ? [{ type: "phone_exact", strength: "strong" }] : []),
      ];
      const result = await this.database.sql`
        INSERT INTO candidate_duplicate_reviews (
          organization_id, canonical_candidate_id, duplicate_candidate_id, signals, state
        ) VALUES (
          ${organizationId}::uuid,
          ${String(pair.canonical_candidate_id)}::uuid,
          ${String(pair.duplicate_candidate_id)}::uuid,
          ${this.database.sql.json(signals as never)},
          'pending'
        )
        ON CONFLICT (organization_id, canonical_candidate_id, duplicate_candidate_id) DO NOTHING
        RETURNING id
      `;
      if (result[0]) created += 1;
    }
    return { scannedPairs: pairs.length, reviewsCreated: created };
  }

  async listDuplicateReviews(state = "pending") {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT
        r.id::text,
        r.state,
        r.signals,
        r.reason,
        r.reviewed_at,
        r.created_at,
        c1.id::text AS canonical_candidate_id,
        c1.display_name AS canonical_name,
        c2.id::text AS duplicate_candidate_id,
        c2.display_name AS duplicate_name
      FROM candidate_duplicate_reviews r
      JOIN candidates c1
        ON c1.organization_id = r.organization_id AND c1.id = r.canonical_candidate_id
      JOIN candidates c2
        ON c2.organization_id = r.organization_id AND c2.id = r.duplicate_candidate_id
      WHERE r.organization_id = ${organizationId}::uuid
        AND r.state = ${state}
      ORDER BY r.created_at DESC
    `;
    return rows.map((row) => ({
      id: String(row.id),
      state: String(row.state),
      signals: Array.isArray(row.signals) ? row.signals : [],
      canonicalCandidate: { id: String(row.canonical_candidate_id), displayName: String(row.canonical_name) },
      duplicateCandidate: { id: String(row.duplicate_candidate_id), displayName: String(row.duplicate_name) },
      ...(row.reason ? { reason: String(row.reason) } : {}),
      ...(row.reviewed_at ? { reviewedAt: new Date(String(row.reviewed_at)).toISOString() } : {}),
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
  }

  async resolveDuplicateReview(reviewId: string, input: ResolveDuplicateReviewDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = currentUserId(this.authContext);
    return this.database.sql.begin(async (tx) => {
      const reviews = await tx`
        SELECT id::text, canonical_candidate_id::text, duplicate_candidate_id::text, state
        FROM candidate_duplicate_reviews
        WHERE organization_id = ${organizationId}::uuid AND id = ${reviewId}::uuid
        LIMIT 1
        FOR UPDATE
      `;
      const review = reviews[0];
      if (!review) throw new NotFoundException("Duplicate review not found");
      if (String(review.state) !== "pending") throw new BadRequestException("Duplicate review is already resolved");

      if (input.decision === "accepted") {
        await tx`
          INSERT INTO candidate_aliases (
            organization_id, duplicate_candidate_id, canonical_candidate_id, review_id
          ) VALUES (
            ${organizationId}::uuid,
            ${String(review.duplicate_candidate_id)}::uuid,
            ${String(review.canonical_candidate_id)}::uuid,
            ${reviewId}::uuid
          )
          ON CONFLICT (organization_id, duplicate_candidate_id) DO UPDATE
          SET canonical_candidate_id = EXCLUDED.canonical_candidate_id,
              review_id = EXCLUDED.review_id
        `;
      }
      await tx`
        UPDATE candidate_duplicate_reviews
        SET state = ${input.decision}, reviewed_by_user_id = ${userId}::uuid,
            reason = ${input.reason.trim()}, reviewed_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${reviewId}::uuid
      `;
      return {
        reviewId,
        state: input.decision,
        canonicalCandidateId: String(review.canonical_candidate_id),
        duplicateCandidateId: String(review.duplicate_candidate_id),
        canonicalized: input.decision === "accepted",
        mergeMode: "non_destructive_alias",
      };
    });
  }

  async calculateMatch(jobId: string, input: CandidateMatchRequestDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const requirements = await this.database.sql`
      SELECT id::text, name, description, weight, requirement_type
      FROM job_requirements
      WHERE organization_id = ${organizationId}::uuid AND job_id = ${jobId}::uuid
      ORDER BY CASE requirement_type WHEN 'must_have' THEN 0 ELSE 1 END, weight DESC
    `;
    const candidates = await this.database.sql`
      SELECT id::text
      FROM candidates
      WHERE organization_id = ${organizationId}::uuid AND id = ${input.candidateId}::uuid
      LIMIT 1
    `;
    if (!candidates[0]) throw new NotFoundException("Candidate not found");
    if (input.applicationId) {
      const applications = await this.database.sql`
        SELECT 1 FROM applications
        WHERE organization_id = ${organizationId}::uuid
          AND id = ${input.applicationId}::uuid
          AND job_id = ${jobId}::uuid
          AND candidate_id = ${input.candidateId}::uuid
        LIMIT 1
      `;
      if (!applications[0]) throw new BadRequestException("Application does not match candidate and job");
    }
    const skills = await this.database.sql`
      SELECT skill_label, verification_state, source_reference
      FROM candidate_skills
      WHERE organization_id = ${organizationId}::uuid AND candidate_id = ${input.candidateId}::uuid
    `;
    const experiences = await this.database.sql`
      SELECT title, description, source_reference
      FROM candidate_experiences
      WHERE organization_id = ${organizationId}::uuid AND candidate_id = ${input.candidateId}::uuid
    `;

    const result = calculateEvidenceConceptMatch({
      requirements: requirements.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        ...(row.description ? { description: String(row.description) } : {}),
        weight: Number(row.weight),
        requirementType: String(row.requirement_type) as "must_have" | "nice_to_have",
      })),
      skills: skills.map((row) => ({
        label: String(row.skill_label),
        ...(row.verification_state ? { verificationState: String(row.verification_state) } : {}),
        ...(row.source_reference ? { sourceReference: String(row.source_reference) } : {}),
      })),
      experiences: experiences.map((row) => ({
        title: String(row.title),
        ...(row.description ? { description: String(row.description) } : {}),
        ...(row.source_reference ? { sourceReference: String(row.source_reference) } : {}),
      })),
    });

    const snapshots = await this.database.sql`
      INSERT INTO candidate_match_snapshots (
        organization_id, job_id, candidate_id, application_id, score, components, algorithm_version
      ) VALUES (
        ${organizationId}::uuid,
        ${jobId}::uuid,
        ${input.candidateId}::uuid,
        ${input.applicationId ?? null}::uuid,
        ${result.score},
        ${this.database.sql.json({
          requirements: result.components,
          missingMustHaveRequirementIds: result.missingMustHaveRequirementIds,
          notice: result.notice,
        } as never)},
        ${result.algorithmVersion}
      )
      RETURNING id::text, created_at
    `;

    if (input.applicationId) {
      await this.database.sql`
        UPDATE applications
        SET pre_interview_match_score = ${result.score}, updated_at = now()
        WHERE organization_id = ${organizationId}::uuid AND id = ${input.applicationId}::uuid
      `;
    }

    return {
      snapshotId: String(snapshots[0]?.id),
      createdAt: new Date(String(snapshots[0]?.created_at)).toISOString(),
      ...result,
    };
  }

  async listMatchSnapshots(jobId: string, candidateId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT id::text, application_id::text, score, components, algorithm_version, created_at
      FROM candidate_match_snapshots
      WHERE organization_id = ${organizationId}::uuid
        AND job_id = ${jobId}::uuid
        AND candidate_id = ${candidateId}::uuid
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return rows.map((row) => ({
      id: String(row.id),
      ...(row.application_id ? { applicationId: String(row.application_id) } : {}),
      score: Number(row.score),
      components: row.components && typeof row.components === "object" ? row.components : {},
      algorithmVersion: String(row.algorithm_version),
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
  }
}
