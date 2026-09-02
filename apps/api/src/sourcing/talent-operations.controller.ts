import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiQuery, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  CandidateMatchRequestDto,
  ResolveDuplicateReviewDto,
  UpsertTalentEntryDto,
} from "./talent-operations.dto";
import { TalentOperationsService } from "./talent-operations.service";

@ApiTags("talent-operations")
@Controller("v1")
@RequireTenant()
export class TalentOperationsController {
  constructor(private readonly talent: TalentOperationsService) {}

  @Patch("talent/:candidateId")
  @RequirePermissions(Permissions.TalentManage)
  @AuditedAction("talent.entry.upsert", "candidate")
  upsertTalent(@Param("candidateId") candidateId: string, @Body() body: UpsertTalentEntryDto) {
    return this.talent.upsertTalentEntry(candidateId, body);
  }

  @Post("talent/dedupe/scan")
  @RequirePermissions(Permissions.TalentManage)
  @AuditedAction("talent.dedupe.scan", "organization")
  scanDuplicates() {
    return this.talent.scanDuplicates();
  }

  @Get("talent/dedupe/reviews")
  @RequirePermissions(Permissions.CandidateRead)
  @ApiQuery({ name: "state", required: false, type: String })
  listDuplicateReviews(@Query("state") state?: string) {
    return this.talent.listDuplicateReviews(state?.trim() || "pending");
  }

  @Post("talent/dedupe/reviews/:reviewId/resolve")
  @RequirePermissions(Permissions.TalentManage)
  @AuditedAction("talent.dedupe.resolve", "candidate_duplicate_review")
  resolveDuplicateReview(
    @Param("reviewId") reviewId: string,
    @Body() body: ResolveDuplicateReviewDto,
  ) {
    return this.talent.resolveDuplicateReview(reviewId, body);
  }

  @Post("jobs/:jobId/matches")
  @RequirePermissions(Permissions.CandidateRead)
  @AuditedAction("candidate.match.calculate", "job")
  calculateMatch(@Param("jobId") jobId: string, @Body() body: CandidateMatchRequestDto) {
    return this.talent.calculateMatch(jobId, body);
  }

  @Get("jobs/:jobId/candidates/:candidateId/matches")
  @RequirePermissions(Permissions.CandidateRead)
  listMatches(@Param("jobId") jobId: string, @Param("candidateId") candidateId: string) {
    return this.talent.listMatchSnapshots(jobId, candidateId);
  }
}
