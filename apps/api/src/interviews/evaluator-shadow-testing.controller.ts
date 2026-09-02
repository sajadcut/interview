import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { EvaluatorShadowTestingService } from "./evaluator-shadow-testing.service";

@ApiExcludeController()
@Controller("v1/evaluator/shadow")
@RequireTenant()
@RequirePermissions(Permissions.InterviewEvaluate)
export class EvaluatorShadowTestingController {
  constructor(private readonly shadow: EvaluatorShadowTestingService) {}

  @Post("programs")
  @AuditedAction("evaluator.shadow.program.create", "evaluator_shadow_program")
  createProgram(@Body() body: unknown) {
    return this.shadow.createProgram(body);
  }

  @Get("programs")
  listPrograms() {
    return this.shadow.listPrograms();
  }

  @Post("programs/:programId/activate")
  @AuditedAction("evaluator.shadow.program.activate", "evaluator_shadow_program")
  activateProgram(@Param("programId", new ParseUUIDPipe()) programId: string) {
    return this.shadow.activateProgram(programId);
  }

  @Post("programs/:programId/pause")
  @AuditedAction("evaluator.shadow.program.pause", "evaluator_shadow_program")
  pauseProgram(@Param("programId", new ParseUUIDPipe()) programId: string) {
    return this.shadow.pauseProgram(programId);
  }

  @Post("programs/:programId/complete")
  @AuditedAction("evaluator.shadow.program.complete", "evaluator_shadow_program")
  completeProgram(@Param("programId", new ParseUUIDPipe()) programId: string) {
    return this.shadow.completeProgram(programId);
  }

  @Post("programs/:programId/runs")
  @AuditedAction("evaluator.shadow.run.record", "evaluator_shadow_run")
  recordRun(
    @Param("programId", new ParseUUIDPipe()) programId: string,
    @Body() body: unknown,
  ) {
    return this.shadow.recordRun(programId, body);
  }

  @Get("runs/:runId")
  getRun(@Param("runId", new ParseUUIDPipe()) runId: string) {
    return this.shadow.getRun(runId);
  }

  @Post("runs/:runId/human-outcome")
  @AuditedAction("evaluator.shadow.human_outcome.record", "evaluator_shadow_run")
  recordHumanOutcome(
    @Param("runId", new ParseUUIDPipe()) runId: string,
    @Body() body: unknown,
  ) {
    return this.shadow.recordHumanOutcome(runId, body);
  }

  @Post("comparisons/:comparisonId/root-cause")
  @AuditedAction("evaluator.shadow.root_cause.record", "evaluator_shadow_comparison")
  recordRootCauseReview(
    @Param("comparisonId", new ParseUUIDPipe()) comparisonId: string,
    @Body() body: unknown,
  ) {
    return this.shadow.recordRootCauseReview(comparisonId, body);
  }

  @Get("programs/:programId/summary")
  summary(@Param("programId", new ParseUUIDPipe()) programId: string): Promise<unknown> {
    return this.shadow.summary(programId);
  }
}
