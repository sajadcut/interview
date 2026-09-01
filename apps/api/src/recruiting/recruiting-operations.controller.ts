import { Body, Controller, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  CreateCriterionEvaluationDto,
  CreateEvidenceDto,
  CreateJobDto,
  MoveApplicationStageDto,
  SaveRubricDraftDto,
  SubmitHiringDecisionDto,
  UpdateJobDto,
  UpsertShortlistDto,
} from "./recruiting-operations.dto";
import { RecruitingOperationsService } from "./recruiting-operations.service";

@ApiTags("recruiting-operations")
@ApiStandardErrorResponses()
@Controller("v1")
@RequireTenant()
export class RecruitingOperationsController {
  constructor(private readonly operations: RecruitingOperationsService) {}

  @Post("jobs")
  @RequirePermissions(Permissions.JobCreate)
  @AuditedAction("job.create", "job")
  createJob(@Body() body: CreateJobDto) {
    return this.operations.createJob(body);
  }

  @Patch("jobs/:jobId")
  @RequirePermissions(Permissions.JobEdit)
  @AuditedAction("job.update", "job")
  updateJob(@Param("jobId") jobId: string, @Body() body: UpdateJobDto) {
    return this.operations.updateJob(jobId, body);
  }

  @Put("jobs/:jobId/rubric/draft")
  @RequirePermissions(Permissions.JobEdit)
  @AuditedAction("rubric.draft.save", "job")
  saveRubricDraft(@Param("jobId") jobId: string, @Body() body: SaveRubricDraftDto) {
    return this.operations.saveRubricDraft(jobId, body);
  }

  @Post("jobs/:jobId/rubric/publish")
  @RequirePermissions(Permissions.JobEdit)
  @AuditedAction("rubric.publish", "job")
  publishRubric(@Param("jobId") jobId: string) {
    return this.operations.publishRubric(jobId);
  }

  @Post("applications/:applicationId/stage")
  @RequirePermissions(Permissions.CandidateMoveStage)
  @AuditedAction("application.stage.move", "application")
  moveApplicationStage(
    @Param("applicationId") applicationId: string,
    @Body() body: MoveApplicationStageDto,
  ) {
    return this.operations.moveApplicationStage(applicationId, body);
  }

  @Post("applications/:applicationId/evidence")
  @RequirePermissions(Permissions.CandidateScore)
  @AuditedAction("evidence.create", "application")
  createEvidence(
    @Param("applicationId") applicationId: string,
    @Body() body: CreateEvidenceDto,
  ) {
    return this.operations.createEvidence(applicationId, body);
  }

  @Post("applications/:applicationId/evaluations")
  @RequirePermissions(Permissions.CandidateScore)
  @AuditedAction("criterion_evaluation.create", "application")
  createCriterionEvaluation(
    @Param("applicationId") applicationId: string,
    @Body() body: CreateCriterionEvaluationDto,
  ) {
    return this.operations.createCriterionEvaluation(applicationId, body);
  }

  @Post("applications/:applicationId/scorecards/finalize")
  @RequirePermissions(Permissions.CandidateScore)
  @AuditedAction("scorecard.finalize", "application")
  finalizeScorecard(@Param("applicationId") applicationId: string) {
    return this.operations.finalizeScorecard(applicationId);
  }

  @Put("jobs/:jobId/shortlist")
  @RequirePermissions(Permissions.DecisionSubmit)
  @AuditedAction("shortlist.upsert", "job")
  upsertShortlist(@Param("jobId") jobId: string, @Body() body: UpsertShortlistDto) {
    return this.operations.upsertShortlist(jobId, body);
  }

  @Post("applications/:applicationId/decision")
  @RequirePermissions(Permissions.DecisionSubmit)
  @AuditedAction("hiring_decision.submit", "application")
  submitDecision(
    @Param("applicationId") applicationId: string,
    @Body() body: SubmitHiringDecisionDto,
  ) {
    return this.operations.submitHiringDecision(applicationId, body);
  }

  @Get("applications/:applicationId/decision-support")
  @RequirePermissions(Permissions.CandidateRead)
  getDecisionSupport(@Param("applicationId") applicationId: string) {
    return this.operations.getDecisionSupport(applicationId);
  }
}
