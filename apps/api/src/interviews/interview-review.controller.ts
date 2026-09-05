import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { CandidateComplaintReviewDto, CompleteInterviewReviewDto, InterviewReviewQueryDto, InterviewReviewTaskDto } from "./interview-review.dto";
import { InterviewReviewService } from "./interview-review.service";

@ApiTags("interview-reviews") @Controller("v1/interview-reviews") @RequireTenant()
export class InterviewReviewController {
  constructor(private readonly service: InterviewReviewService) {}
  @Get() @RequirePermissions(Permissions.InterviewEvaluate) @ApiOkResponse({ type: [InterviewReviewTaskDto] })
  list(@Query() query: InterviewReviewQueryDto) { return this.service.list(query.status, query.limit); }
  @Post(":reviewId/claim") @RequirePermissions(Permissions.InterviewEvaluate) @AuditedAction("interview.review.claim", "interview_review_task")
  claim(@Param("reviewId") id: string) { return this.service.claim(id); }
  @Post(":reviewId/complete") @RequirePermissions(Permissions.InterviewEvaluate) @AuditedAction("interview.review.complete", "interview_review_task")
  complete(@Param("reviewId") id: string, @Body() body: CompleteInterviewReviewDto) { return this.service.complete(id, body); }
  @Get(":reviewId/history") @RequirePermissions(Permissions.InterviewRead)
  history(@Param("reviewId") id: string) { return this.service.history(id); }
  @Post("sessions/:sessionId/candidate-complaint") @RequirePermissions(Permissions.InterviewEvaluate) @AuditedAction("interview.review.candidate_complaint", "interview_session")
  complaint(@Param("sessionId") id: string, @Body() body: CandidateComplaintReviewDto) { return this.service.candidateComplaint(id, body); }
}
