import {
  BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException,
} from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import { SkillProposalProvider } from "./skill-proposal-provider";
import { exactReviewedAlias, validateSkillProposals } from "./skill-proposal-validation";
import type { ReviewSkillProposalDto, ReviewedSkillProposalDto } from "./skill-proposals.dto";

function present(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    skillKey: String(row.skill_key),
    claimText: String(row.claim_text),
    startChar: Number(row.start_char),
    endChar: Number(row.end_char),
    confidence: Number(row.extraction_confidence),
    reviewState: String(row.review_state),
    reviewVersion: Number(row.review_version),
    sourceTextSha256: String(row.source_text_sha256),
    provider: String(row.provider),
    model: String(row.model),
  };
}

@Injectable()
export class SkillProposalsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenant: TenantContextService,
    private readonly auth: AuthContextService,
    private readonly provider: SkillProposalProvider,
  ) {}

  private async document(candidateId: string, resumeId: string) {
    const organizationId = this.tenant.require().organizationId;
    const rows = await this.database.sql`
      SELECT d.text_content, d.text_sha256
      FROM resumes r
      JOIN resume_documents d ON d.organization_id=r.organization_id AND d.resume_id=r.id
      WHERE r.organization_id=${organizationId}::uuid AND r.candidate_id=${candidateId}::uuid
        AND r.id=${resumeId}::uuid AND r.status='completed'
    `;
    if (!rows[0]) throw new NotFoundException("Completed resume document was not found");
    return { text: String(rows[0].text_content), sha: String(rows[0].text_sha256) };
  }

  async list(candidateId: string, resumeId: string) {
    await this.document(candidateId, resumeId);
    const organizationId = this.tenant.require().organizationId;
    const rows = await this.database.sql`
      SELECT p.*, st.skill_key
      FROM resume_skill_proposals p
      JOIN skill_taxonomy st ON st.organization_id=p.organization_id AND st.id=p.skill_id
      JOIN resume_documents d
        ON d.organization_id=p.organization_id AND d.resume_id=p.resume_id
       AND d.text_sha256=p.source_text_sha256
      WHERE p.organization_id=${organizationId}::uuid AND p.candidate_id=${candidateId}::uuid
        AND p.resume_id=${resumeId}::uuid
      ORDER BY p.created_at DESC, p.id DESC LIMIT 100
    `;
    return rows.map(present);
  }

  /** Called only by an authenticated, permission-scoped, explicit user action. */
  async generate(candidateId: string, resumeId: string) {
    const actor = this.auth.getOptional()?.userId;
    if (!actor) throw new UnauthorizedException("Explicit authenticated user consent is required");
    const organizationId = this.tenant.require().organizationId;
    const source = await this.document(candidateId, resumeId);
    if (source.text.length > 12_000 || source.text.length < 40) {
      return { status: "source_too_large", persistedCount: 0, proposals: await this.list(candidateId, resumeId) };
    }

    const skills = await this.database.sql`
      SELECT skill_key, id::text
      FROM skill_taxonomy
      WHERE organization_id=${organizationId}::uuid
      ORDER BY skill_key LIMIT 100
    `;
    if (!skills.length) {
      return { status: "no_taxonomy", persistedCount: 0, proposals: await this.list(candidateId, resumeId) };
    }
    const keys = skills.map((row) => String(row.skill_key));
    const providerResponse = await this.provider.propose({ text: source.text, skillKeys: keys });
    if (providerResponse.status !== "ok") {
      return { status: providerResponse.status, persistedCount: 0, proposals: await this.list(candidateId, resumeId) };
    }

    let items;
    try {
      items = validateSkillProposals(providerResponse.output, source.text, keys);
    } catch {
      // Validation failures do not turn model guesses into candidates' factual skills.
      return { status: "unavailable", persistedCount: 0, proposals: await this.list(candidateId, resumeId) };
    }
    let persistedCount = 0;
    // A parser re-run can replace the resume document while an LLM is responding;
    // the source hash must still match before writing any proposal.
    await this.database.sql.begin(async (tx) => {
      const current = await tx`
        SELECT text_sha256 FROM resume_documents
        WHERE organization_id=${organizationId}::uuid AND resume_id=${resumeId}::uuid FOR UPDATE
      `;
      if (!current[0] || current[0].text_sha256 !== source.sha) {
        throw new ConflictException("Resume was reprocessed; restart proposal extraction");
      }
      for (const item of items) {
        const skill = skills.find((entry) => entry.skill_key === item.skillKey);
        if (!skill) continue;
        const written = await tx`
          INSERT INTO resume_skill_proposals (
            organization_id, candidate_id, resume_id, skill_id, source_text_sha256,
            claim_text, start_char, end_char, extraction_confidence, provider, model
          ) VALUES (
            ${organizationId}::uuid, ${candidateId}::uuid, ${resumeId}::uuid,
            ${String(skill.id)}::uuid, ${source.sha}, ${item.excerpt}, ${item.startChar},
            ${item.endChar}, ${item.confidence}, ${providerResponse.provider.slice(0, 80)},
            ${providerResponse.model.slice(0, 160)}
          )
          ON CONFLICT (organization_id, resume_id, skill_id, source_text_sha256, start_char, end_char)
          DO NOTHING RETURNING id
        `;
        if (written.length) persistedCount++;
      }
    });
    return { status: "ok", persistedCount, proposals: await this.list(candidateId, resumeId) };
  }

  async review(candidateId: string, resumeId: string, proposalId: string, input: ReviewSkillProposalDto):
    Promise<ReviewedSkillProposalDto> {
    const organizationId = this.tenant.require().organizationId;
    const actor = this.auth.getOptional()?.userId;
    if (!actor) throw new UnauthorizedException("Authenticated human reviewer is required");
    const reason = input.reason?.trim() ?? "";
    if (!["approved", "rejected"].includes(input.decision) || reason.length < 8 || reason.length > 1000 ||
        input.expectedVersion !== 0) {
      throw new BadRequestException("Invalid human review decision, reason or revision");
    }
    if (input.reviewedAlias && input.decision !== "approved") {
      throw new BadRequestException("Only approved proposals can register an alias");
    }
    return this.database.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT p.*, d.text_sha256, st.skill_key
        FROM resume_skill_proposals p
        JOIN resume_documents d
          ON d.organization_id=p.organization_id AND d.resume_id=p.resume_id
        JOIN skill_taxonomy st
          ON st.organization_id=p.organization_id AND st.id=p.skill_id
        WHERE p.organization_id=${organizationId}::uuid AND p.candidate_id=${candidateId}::uuid
          AND p.resume_id=${resumeId}::uuid AND p.id=${proposalId}::uuid
        FOR UPDATE OF p
      `;
      const proposal = rows[0];
      if (!proposal) throw new NotFoundException("Skill proposal not found");
      if (proposal.source_text_sha256 !== proposal.text_sha256) {
        throw new ConflictException("Resume source changed; proposed mapping is stale");
      }
      if (proposal.review_state !== "pending" || Number(proposal.review_version) !== input.expectedVersion) {
        throw new ConflictException("Proposal was already reviewed");
      }
      let alias: string | undefined;
      if (input.reviewedAlias) {
        try { alias = exactReviewedAlias(input.reviewedAlias, String(proposal.claim_text)); }
        catch { throw new BadRequestException("Alias must appear verbatim in resume excerpt"); }
        const existing = await tx`
          SELECT skill_id::text FROM skill_aliases
          WHERE organization_id=${organizationId}::uuid AND alias_normalized=${alias}
        `;
        if (existing[0] && String(existing[0].skill_id) !== String(proposal.skill_id)) {
          throw new ConflictException("Reviewed alias already belongs to another canonical skill");
        }
        await tx`
          INSERT INTO skill_aliases(organization_id,skill_id,alias_normalized,origin)
          VALUES (${organizationId}::uuid,${String(proposal.skill_id)}::uuid,${alias},'human_reviewed')
          ON CONFLICT (organization_id, alias_normalized) DO NOTHING
        `;
        // A second reviewer can race to register the same alias. Re-read after
        // unique-index arbitration; never silently approve a conflicting mapping.
        const finalAlias = await tx`
          SELECT skill_id::text FROM skill_aliases
          WHERE organization_id=${organizationId}::uuid AND alias_normalized=${alias}
        `;
        if (String(finalAlias[0]?.skill_id) !== String(proposal.skill_id)) {
          throw new ConflictException("Reviewed alias already belongs to another canonical skill");
        }
      }
      const changed = await tx`
        UPDATE resume_skill_proposals
        SET review_state=${input.decision}, review_version=1,
            review_reason=${reason}, reviewer_user_id=${actor}::uuid, reviewed_at=now()
        WHERE organization_id=${organizationId}::uuid AND id=${proposalId}::uuid
        RETURNING reviewed_at
      `;
      await tx`
        INSERT INTO resume_skill_proposal_review_events(
          organization_id, proposal_id, reviewer_user_id, previous_state, new_state, reason, alias_normalized
        ) VALUES (
          ${organizationId}::uuid,${proposalId}::uuid,${actor}::uuid,'pending',${input.decision},
          ${reason},${alias ?? null}
        )
      `;
      return {
        proposalId, reviewState: input.decision, reviewVersion: 1, reviewerUserId: actor,
        reviewedAt: new Date(String(changed[0]!.reviewed_at)).toISOString(),
      };
    });
  }
}
