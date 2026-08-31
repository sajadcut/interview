import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import { AssessmentsService } from "./assessments.service";

@Controller("v1")
@RequireTenant()
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Post("assessments/:assessmentId/sessions")
  @RequirePermissions(Permissions.AssessmentManage)
  createSession(@Param("assessmentId") assessmentId: string, @Body() body: unknown) {
    return this.assessments.createSession(assessmentId, body);
  }

  @Get("applications/:applicationId/assessments")
  @RequirePermissions(Permissions.AssessmentRead)
  listForApplication(@Param("applicationId") applicationId: string) {
    return this.assessments.listForApplication(applicationId);
  }
}
