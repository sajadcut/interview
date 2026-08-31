import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  AssessmentResultDto,
  AssessmentResultInputDto,
  AssessmentSessionRequestDto,
  AssessmentSubmissionDto,
  AssessmentSubmissionRequestDto,
} from "./assessments.dto";
import { AssessmentsService } from "./assessments.service";

@ApiTags("assessments")
@Controller("v1")
@RequireTenant()
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Post("assessments/:assessmentId/sessions")
  @RequirePermissions(Permissions.AssessmentManage)
  @AuditedAction("assessment.session.create", "assessment")
  createSession(@Param("assessmentId") assessmentId: string, @Body() body: AssessmentSessionRequestDto) {
    return this.assessments.createSession(assessmentId, body);
  }

  @Post("assessment-sessions/:sessionId/submissions")
  @RequirePermissions(Permissions.AssessmentManage)
  @AuditedAction("assessment.submission.create", "assessment_session")
  @ApiOkResponse({ type: AssessmentSubmissionDto })
  createSubmission(
    @Param("sessionId") sessionId: string,
    @Body() body: AssessmentSubmissionRequestDto,
  ) {
    return this.assessments.createSubmission(sessionId, body);
  }

  @Post("assessment-submissions/:submissionId/results")
  @RequirePermissions(Permissions.AssessmentManage)
  @AuditedAction("assessment.result.ingest", "assessment_submission")
  @ApiOkResponse({ type: AssessmentResultDto })
  recordRunnerResult(
    @Param("submissionId") submissionId: string,
    @Body() body: AssessmentResultInputDto,
  ) {
    return this.assessments.recordRunnerResult(submissionId, body);
  }

  @Get("applications/:applicationId/assessments")
  @RequirePermissions(Permissions.AssessmentRead)
  listForApplication(@Param("applicationId") applicationId: string) {
    return this.assessments.listForApplication(applicationId);
  }
}
