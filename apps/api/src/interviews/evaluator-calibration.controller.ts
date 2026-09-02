import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { EvaluatorCalibrationService } from "./evaluator-calibration.service";

@ApiExcludeController()
@Controller("v1/evaluator/calibration/framework")
@RequireTenant()
@RequirePermissions(Permissions.InterviewEvaluate)
export class EvaluatorCalibrationController {
  constructor(private readonly calibration: EvaluatorCalibrationService) {}

  @Post("datasets")
  @AuditedAction("evaluator.calibration.dataset.create", "evaluator_calibration_dataset")
  createDataset(@Body() body: unknown) {
    return this.calibration.createDataset(body);
  }

  @Get("datasets")
  listDatasets() {
    return this.calibration.listDatasets();
  }

  @Post("datasets/:datasetId/cases")
  @AuditedAction("evaluator.calibration.case.create", "evaluator_calibration_case")
  createCase(
    @Param("datasetId", new ParseUUIDPipe()) datasetId: string,
    @Body() body: unknown,
  ) {
    return this.calibration.createCase(datasetId, body);
  }

  @Get("datasets/:datasetId/cases")
  listCases(@Param("datasetId", new ParseUUIDPipe()) datasetId: string) {
    return this.calibration.listCases(datasetId);
  }

  @Post("cases/:caseId/human-reviews")
  @AuditedAction("evaluator.calibration.human_review.record", "evaluator_calibration_case")
  addHumanReview(
    @Param("caseId", new ParseUUIDPipe()) caseId: string,
    @Body() body: unknown,
  ) {
    return this.calibration.addHumanReview(caseId, body);
  }

  @Post("datasets/:datasetId/lock")
  @AuditedAction("evaluator.calibration.dataset.lock", "evaluator_calibration_dataset")
  lockDataset(@Param("datasetId", new ParseUUIDPipe()) datasetId: string) {
    return this.calibration.lockDataset(datasetId);
  }

  @Post("cases/:caseId/runs")
  @AuditedAction("evaluator.calibration.run.record", "evaluator_calibration_case")
  recordRun(
    @Param("caseId", new ParseUUIDPipe()) caseId: string,
    @Body() body: unknown,
  ) {
    return this.calibration.recordRun(caseId, body);
  }

  @Get("runs/:runId")
  getRun(@Param("runId", new ParseUUIDPipe()) runId: string) {
    return this.calibration.getRun(runId);
  }

  @Get("datasets/:datasetId/summary")
  summary(
    @Param("datasetId", new ParseUUIDPipe()) datasetId: string,
    @Query("evaluatorVersion") evaluatorVersion = "",
  ) {
    return this.calibration.summary(datasetId, evaluatorVersion);
  }

  @Get("datasets/:datasetId/gate")
  gate(
    @Param("datasetId", new ParseUUIDPipe()) datasetId: string,
    @Query("evaluatorVersion") evaluatorVersion = "",
  ) {
    return this.calibration.gate(datasetId, evaluatorVersion);
  }
}
