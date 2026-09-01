import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { ReviewScorecardDto, ScorecardReviewDto } from "./scorecard-review.dto";
import { ScorecardReviewService } from "./scorecard-review.service";

@ApiTags("scorecard-reviews")
@Controller("v1/scorecards")
@RequireTenant()
export class ScorecardReviewController {
  constructor(private readonly reviews: ScorecardReviewService) {}

  @Post(":scorecardId/reviews")
  @RequirePermissions(Permissions.CandidateScore)
  @AuditedAction("scorecard.review", "scorecard")
  @ApiOkResponse({ type: ScorecardReviewDto })
  review(@Param("scorecardId") scorecardId: string, @Body() body: ReviewScorecardDto) {
    return this.reviews.review(scorecardId, body);
  }

  @Get(":scorecardId/reviews")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiOkResponse({ type: ScorecardReviewDto, isArray: true })
  list(@Param("scorecardId") scorecardId: string) {
    return this.reviews.list(scorecardId);
  }
}
