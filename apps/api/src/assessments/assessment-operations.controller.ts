import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuditedAction } from "../audit/audited-action.decorator";
import { CANDIDATE_SESSION_COOKIE } from "../auth/candidate-session.service";
import { readCookie } from "../auth/cookie";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { QueueAssessmentExecutionDto, ReviewAssessmentDto } from "./assessment-operations.dto";
import { AssessmentOperationsService } from "./assessment-operations.service";
import { AssessmentSubmissionRequestDto } from "./assessments.dto";

@ApiTags("assessment-operations")
@Controller("v1")
@RequireTenant()
export class AssessmentOperationsController {
  constructor(private readonly operations: AssessmentOperationsService) {}

  @Post("assessment-submissions/:submissionId/execution-jobs")
  @RequirePermissions(Permissions.AssessmentManage)
  @AuditedAction("assessment.execution.queue", "assessment_submission")
  queueExecution(
    @Param("submissionId") submissionId: string,
    @Body() body: QueueAssessmentExecutionDto,
  ) {
    return this.operations.queueExecution(submissionId, body);
  }

  @Get("assessment-execution-jobs")
  @RequirePermissions(Permissions.AssessmentManage)
  listExecutionJobs() {
    return this.operations.listExecutionJobs();
  }

  @Post("assessment-sessions/:sessionId/review")
  @RequirePermissions(Permissions.AssessmentManage)
  @AuditedAction("assessment.review.submit", "assessment_session")
  review(@Param("sessionId") sessionId: string, @Body() body: ReviewAssessmentDto) {
    return this.operations.reviewAssessment(sessionId, body);
  }
}

@ApiTags("candidate-assessments")
@Controller("v1/candidate/assessments")
export class CandidateAssessmentsController {
  constructor(private readonly operations: AssessmentOperationsService) {}

  private token(request: Request): string | undefined {
    return readCookie(request.header("cookie"), CANDIDATE_SESSION_COOKIE);
  }

  @Get()
  list(@Req() request: Request) {
    return this.operations.listCandidateAssessments(this.token(request));
  }

  @Post(":sessionId/start")
  start(@Param("sessionId") sessionId: string, @Req() request: Request) {
    return this.operations.startCandidateAssessment(this.token(request), sessionId);
  }

  @Post(":sessionId/submissions")
  submit(
    @Param("sessionId") sessionId: string,
    @Body() body: AssessmentSubmissionRequestDto,
    @Req() request: Request,
  ) {
    return this.operations.submitCandidateAssessment(this.token(request), sessionId, body);
  }
}
