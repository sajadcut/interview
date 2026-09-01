import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthContextService } from "../auth/auth-context.service";
import { DatabaseService } from "../database/database.service";
import { TenantContextService } from "../tenant/tenant-context.service";
import type { ReviewScorecardDto } from "./scorecard-review.dto";

function reviewerId(auth: AuthContextService): string {
  const userId = auth.getOptional()?.userId;
  if (!userId) throw new BadRequestException("Authenticated reviewer context is required");
  return userId;
}

@Injectable()
export class ScorecardReviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tenantContext: TenantContextService,
    private readonly authContext: AuthContextService,
  ) {}

  async review(scorecardId: string, input: ReviewScorecardDto) {
    const organizationId = this.tenantContext.require().organizationId;
    const userId = reviewerId(this.authContext);
    return this.database.sql.begin(async (tx) => {
      const scorecards = await tx`
        SELECT id::text, application_id::text, overall_score, recommendation, review_state
        FROM scorecards
        WHERE organization_id = ${organizationId}::uuid AND id = ${scorecardId}::uuid
        LIMIT 1
        FOR UPDATE
      `;
      const scorecard = scorecards[0];
      if (!scorecard) throw new NotFoundException("Scorecard not found");

      if (input.reviewState === "overridden" && !input.humanRecommendation && input.humanOverallScore === undefined) {
        throw new BadRequestException("An override must include a human recommendation or human overall score");
      }
      if (input.reviewState === "needs_more_evidence" && (input.humanRecommendation || input.humanOverallScore !== undefined)) {
        throw new BadRequestException("Needs-more-evidence review must not invent a replacement score or recommendation");
      }

      const algorithmRecommendation = scorecard.recommendation ? String(scorecard.recommendation) : undefined;
      const algorithmOverallScore = scorecard.overall_score === null || scorecard.overall_score === undefined
        ? undefined
        : Number(scorecard.overall_score);
      const disagreement =
        input.reviewState === "overridden" &&
        ((input.humanRecommendation !== undefined && input.humanRecommendation !== algorithmRecommendation) ||
          (input.humanOverallScore !== undefined && input.humanOverallScore !== algorithmOverallScore));

      const rows = await tx`
        INSERT INTO scorecard_reviews (
          organization_id, scorecard_id, application_id, reviewer_user_id,
          review_state, human_recommendation, human_overall_score, reason,
          ai_human_disagreement, algorithm_recommendation, algorithm_overall_score
        ) VALUES (
          ${organizationId}::uuid,
          ${scorecardId}::uuid,
          ${String(scorecard.application_id)}::uuid,
          ${userId}::uuid,
          ${input.reviewState},
          ${input.humanRecommendation ?? null},
          ${input.humanOverallScore ?? null},
          ${input.reason.trim()},
          ${disagreement},
          ${algorithmRecommendation ?? null},
          ${algorithmOverallScore ?? null}
        )
        RETURNING id::text, created_at
      `;
      const reviewId = String(rows[0]?.id);
      await tx`
        UPDATE scorecards
        SET review_state = ${input.reviewState},
            latest_human_review_id = ${reviewId}::uuid,
            released_at = CASE WHEN ${input.reviewState === "approved" || input.reviewState === "overridden"} THEN now() ELSE NULL END,
            released_by_user_id = CASE WHEN ${input.reviewState === "approved" || input.reviewState === "overridden"} THEN ${userId}::uuid ELSE NULL END
        WHERE organization_id = ${organizationId}::uuid AND id = ${scorecardId}::uuid
      `;

      return {
        id: reviewId,
        scorecardId,
        applicationId: String(scorecard.application_id),
        reviewerUserId: userId,
        reviewState: input.reviewState,
        ...(input.humanRecommendation ? { humanRecommendation: input.humanRecommendation } : {}),
        ...(input.humanOverallScore !== undefined ? { humanOverallScore: input.humanOverallScore } : {}),
        reason: input.reason.trim(),
        aiHumanDisagreement: disagreement,
        ...(algorithmRecommendation ? { algorithmRecommendation } : {}),
        ...(algorithmOverallScore !== undefined ? { algorithmOverallScore } : {}),
        createdAt: new Date(String(rows[0]?.created_at)).toISOString(),
      };
    });
  }

  async list(scorecardId: string) {
    const organizationId = this.tenantContext.require().organizationId;
    const rows = await this.database.sql`
      SELECT id::text, scorecard_id::text, application_id::text, reviewer_user_id::text,
             review_state, human_recommendation, human_overall_score, reason,
             ai_human_disagreement, algorithm_recommendation, algorithm_overall_score, created_at
      FROM scorecard_reviews
      WHERE organization_id = ${organizationId}::uuid AND scorecard_id = ${scorecardId}::uuid
      ORDER BY created_at DESC
    `;
    return rows.map((row) => ({
      id: String(row.id),
      scorecardId: String(row.scorecard_id),
      applicationId: String(row.application_id),
      reviewerUserId: String(row.reviewer_user_id),
      reviewState: String(row.review_state),
      ...(row.human_recommendation ? { humanRecommendation: String(row.human_recommendation) } : {}),
      ...(row.human_overall_score !== null && row.human_overall_score !== undefined
        ? { humanOverallScore: Number(row.human_overall_score) }
        : {}),
      reason: String(row.reason),
      aiHumanDisagreement: Boolean(row.ai_human_disagreement),
      ...(row.algorithm_recommendation ? { algorithmRecommendation: String(row.algorithm_recommendation) } : {}),
      ...(row.algorithm_overall_score !== null && row.algorithm_overall_score !== undefined
        ? { algorithmOverallScore: Number(row.algorithm_overall_score) }
        : {}),
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
  }
}
