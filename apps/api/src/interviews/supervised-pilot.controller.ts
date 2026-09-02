import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { SupervisedPilotService } from "./supervised-pilot.service";

@ApiExcludeController()
@Controller("v1/interviews/pilot")
@RequireTenant()
export class SupervisedPilotController {
  constructor(private readonly pilot: SupervisedPilotService) {}

  @Post("programs")
  @RequirePermissions(Permissions.SettingsManage)
  @AuditedAction("interview.pilot.program.create", "supervised_pilot_program")
  createProgram(@Body() body: unknown) {
    return this.pilot.createProgram(body);
  }

  @Get("programs")
  @RequirePermissions(Permissions.InterviewRead)
  listPrograms() {
    return this.pilot.listPrograms();
  }

  @Get("programs/:programId/summary")
  @RequirePermissions(Permissions.InterviewRead)
  summary(@Param("programId", new ParseUUIDPipe()) programId: string) {
    return this.pilot.summary(programId);
  }

  @Post("programs/:programId/feature")
  @RequirePermissions(Permissions.SettingsManage)
  @AuditedAction("interview.pilot.feature.set", "supervised_pilot_program")
  setFeature(
    @Param("programId", new ParseUUIDPipe()) programId: string,
    @Body() body: unknown,
  ) {
    return this.pilot.setFeature(programId, body);
  }

  @Post("programs/:programId/submit")
  @RequirePermissions(Permissions.SettingsManage)
  @AuditedAction("interview.pilot.approval.submit", "supervised_pilot_program")
  submit(@Param("programId", new ParseUUIDPipe()) programId: string) {
    return this.pilot.submitForApproval(programId);
  }

  @Post("programs/:programId/approvals/:kind/approve")
  @RequirePermissions(Permissions.SettingsManage)
  @AuditedAction("interview.pilot.approval.approve", "supervised_pilot_approval")
  approve(
    @Param("programId", new ParseUUIDPipe()) programId: string,
    @Param("kind") kind: string,
    @Body() body: unknown,
  ) {
    return this.pilot.decideApproval(programId, kind, body, "approved");
  }

  @Post("programs/:programId/approvals/:kind/reject")
  @RequirePermissions(Permissions.SettingsManage)
  @AuditedAction("interview.pilot.approval.reject", "supervised_pilot_approval")
  reject(
    @Param("programId", new ParseUUIDPipe()) programId: string,
    @Param("kind") kind: string,
    @Body() body: unknown,
  ) {
    return this.pilot.decideApproval(programId, kind, body, "rejected");
  }

  @Post("programs/:programId/activate")
  @RequirePermissions(Permissions.SettingsManage)
  @AuditedAction("interview.pilot.program.activate", "supervised_pilot_program")
  activate(@Param("programId", new ParseUUIDPipe()) programId: string) {
    return this.pilot.activate(programId);
  }

  @Post("programs/:programId/pause")
  @RequirePermissions(Permissions.SettingsManage)
  @AuditedAction("interview.pilot.program.pause", "supervised_pilot_program")
  pause(@Param("programId", new ParseUUIDPipe()) programId: string) {
    return this.pilot.pause(programId);
  }

  @Post("programs/:programId/revoke")
  @RequirePermissions(Permissions.SettingsManage)
  @AuditedAction("interview.pilot.program.revoke", "supervised_pilot_program")
  revoke(@Param("programId", new ParseUUIDPipe()) programId: string) {
    return this.pilot.revoke(programId);
  }

  @Post("programs/:programId/complete")
  @RequirePermissions(Permissions.SettingsManage)
  @AuditedAction("interview.pilot.program.complete", "supervised_pilot_program")
  complete(@Param("programId", new ParseUUIDPipe()) programId: string) {
    return this.pilot.complete(programId);
  }

  @Post("sessions/:sessionId/reassign-review")
  @RequirePermissions(Permissions.InterviewManage)
  @AuditedAction("interview.pilot.review.reassign", "supervised_pilot_human_review")
  reassignReview(
    @Param("sessionId", new ParseUUIDPipe()) sessionId: string,
    @Body() body: unknown,
  ) {
    return this.pilot.reassignReview(sessionId, body);
  }

  @Post("sessions/:sessionId/human-review")
  @RequirePermissions(Permissions.InterviewEvaluate)
  @AuditedAction("interview.pilot.human_review.complete", "supervised_pilot_human_review")
  recordHumanReview(
    @Param("sessionId", new ParseUUIDPipe()) sessionId: string,
    @Body() body: unknown,
  ) {
    return this.pilot.recordHumanReview(sessionId, body);
  }
}
