import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  ApprovedSourceTypes,
  type CandidateSourceAdapter,
  type CandidateSourceResult,
  type CandidateSourceSearchRequest,
} from "./candidate-source.adapter";

@Injectable()
export class InternalTalentPoolAdapter implements CandidateSourceAdapter {
  readonly sourceType = ApprovedSourceTypes.InternalTalentPool;
  readonly providerKey = "internal-postgres";
  readonly requiresApproval = false;

  constructor(private readonly database: DatabaseService) {}

  async search(request: CandidateSourceSearchRequest): Promise<CandidateSourceResult[]> {
    const pattern = `%${request.query.trim()}%`;
    const rows = await this.database.sql`
      SELECT
        c.id,
        c.display_name,
        c."current_role",
        c.current_company,
        c.updated_at,
        COALESCE(array_agg(DISTINCT cs.skill_label) FILTER (WHERE cs.skill_label IS NOT NULL), '{}') AS skills,
        CASE
          WHEN c."current_role" ILIKE ${pattern} THEN 1.0
          WHEN c.display_name ILIKE ${pattern} THEN 0.9
          WHEN bool_or(cs.skill_label ILIKE ${pattern}) THEN 0.8
          ELSE 0.5
        END AS retrieval_score
      FROM talent_pool_entries t
      JOIN candidates c
        ON c.organization_id = t.organization_id AND c.id = t.candidate_id
      LEFT JOIN candidate_skills cs
        ON cs.organization_id = c.organization_id AND cs.candidate_id = c.id
      WHERE t.organization_id = ${request.organizationId}::uuid
        AND t.status = 'active'
        AND (
          c.display_name ILIKE ${pattern}
          OR c."current_role" ILIKE ${pattern}
          OR c.current_company ILIKE ${pattern}
          OR cs.skill_label ILIKE ${pattern}
        )
      GROUP BY c.id, c.display_name, c."current_role", c.current_company, c.updated_at
      ORDER BY retrieval_score DESC, c.updated_at DESC
      LIMIT ${request.limit}
    `;

    const retrievedAt = new Date().toISOString();
    return rows.map((row) => {
      const skills = Array.isArray(row.skills) ? row.skills.map(String) : [];
      const displayName = String(row.display_name);
      const currentRole = row.current_role ? String(row.current_role) : undefined;
      const currentCompany = row.current_company ? String(row.current_company) : undefined;
      const candidateId = String(row.id);

      return {
        sourceType: this.sourceType,
        candidateId,
        displayName,
        ...(currentRole ? { currentRole } : {}),
        ...(currentCompany ? { currentCompany } : {}),
        skills,
        retrievalScore: Number(row.retrieval_score),
        evidenceSummary: [
          currentRole ? `Current role: ${currentRole}` : "Current role not provided",
          skills.length ? `Skills: ${skills.join(", ")}` : "No indexed skills",
        ],
        provenance: {
          providerKey: this.providerKey,
          sourceType: this.sourceType,
          observedAt: new Date(String(row.updated_at)).toISOString(),
          retrievedAt,
          externalKey: candidateId,
          evidenceReferences: [`candidate:${candidateId}`, `talent_pool:${candidateId}`],
        },
      } satisfies CandidateSourceResult;
    });
  }
}
