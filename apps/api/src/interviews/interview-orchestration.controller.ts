import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { InterviewEvaluatorInputDto } from "./interview-evaluator-input.dto";
import {
  CreateEvaluatorCalibrationCaseDto,
  EvaluatorCalibrationRunDto,
  EvaluatorCalibrationSummaryDto,
  GenerateInterviewPlanDto,
  InterviewPlanGeneratedDto,
  RecordEvaluatorCalibrationRunDto,
} from "./interview-orchestration.dto";
import { InterviewOrchestrationService } from "./interview-orchestration.service";

@ApiTags("interviews")
@Controller("v1")
@RequireTenant()
@ApiStandardErrorResponses()
export class InterviewOrchestrationController {
  constructor(private readonly orchestration: InterviewOrchestrationService) {}

  @Post("jobs/:jobId/interview-plans/generate")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.plan.generate", "job")
  @ApiOkResponse({ type: InterviewPlanGeneratedDto })
  generatePlan(@Param("jobId") jobId: string, @Body() body: GenerateInterviewPlanDto) {
    return this.orchestration.generatePlan(jobId, body);
  }

  @Post("interview-plans/:planId/publish")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.plan.publish", "interview_plan")
  @ApiOkResponse({ type: InterviewPlanGeneratedDto })
  publishPlan(@Param("planId") planId: string) {
    return this.orchestration.publishPlan(planId);
  }

  @Get("interviews/:sessionId/evaluator-input")
  @RequirePermissions(Permissions.InterviewEvaluate)
  @ApiOkResponse({ type: InterviewEvaluatorInputDto })
  evaluatorInput(@Param("sessionId") sessionId: string) {
    return this.orchestration.evaluatorInput(sessionId);
  }

  @Post("evaluator/calibration/cases")
  @RequirePermissions(Permissions.InterviewEvaluate)
  @AuditedAction("evaluator.calibration.case.create", "evaluator_calibration_case")
  createCalibrationCase(@Body() body: CreateEvaluatorCalibrationCaseDto) {
    return this.orchestration.createCalibrationCase(body);
  }

  @Post("evaluator/calibration/cases/:caseId/runs")
  @RequirePermissions(Permissions.InterviewEvaluate)
  @AuditedAction("evaluator.calibration.run.record", "evaluator_calibration_case")
  @ApiOkResponse({ type: EvaluatorCalibrationRunDto })
  recordCalibrationRun(
    @Param("caseId") caseId: string,
    @Body() body: RecordEvaluatorCalibrationRunDto,
  ) {
    return this.orchestration.recordCalibrationRun(caseId, body);
  }

  @Get("evaluator/calibration/summary")
  @RequirePermissions(Permissions.InterviewEvaluate)
  @ApiQuery({ name: "evaluatorVersion", required: true, type: String })
  @ApiOkResponse({ type: EvaluatorCalibrationSummaryDto })
  calibrationSummary(@Query("evaluatorVersion") evaluatorVersion: string) {
    return this.orchestration.calibrationSummary(evaluatorVersion);
  }
}
