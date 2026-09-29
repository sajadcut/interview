import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  CreateHiringRequestDto, LinkHiringRequestJobDto, ReviewHiringRequestDto, SubmitTechnicalApprovalDto,
} from "./hiring-requests.dto";
import { HiringRequestsService } from "./hiring-requests.service";

@ApiTags("hiring-requests")
@ApiStandardErrorResponses()
@Controller("v1")
@RequireTenant()
export class HiringRequestsController {
  constructor(private readonly hiringRequests: HiringRequestsService) {}

  @Get("hiring-requests")
  @RequirePermissions(Permissions.HiringRequestRead)
  listHiringRequests() { return this.hiringRequests.listHiringRequests(); }

  @Post("hiring-requests")
  @RequirePermissions(Permissions.HiringRequestCreate)
  @AuditedAction("hiring_request.create", "hiring_request")
  createHiringRequest(@Body() body: CreateHiringRequestDto) { return this.hiringRequests.createHiringRequest(body); }

  @Post("hiring-requests/:hiringRequestId/submit")
  @RequirePermissions(Permissions.HiringRequestCreate)
  @AuditedAction("hiring_request.submit", "hiring_request")
  submitHiringRequest(@Param("hiringRequestId") hiringRequestId: string) {
    return this.hiringRequests.submitHiringRequest(hiringRequestId);
  }

  @Post("hiring-requests/:hiringRequestId/review")
  @RequirePermissions(Permissions.HiringRequestManage)
  @AuditedAction("hiring_request.review", "hiring_request")
  reviewHiringRequest(@Param("hiringRequestId") hiringRequestId: string, @Body() body: ReviewHiringRequestDto) {
    return this.hiringRequests.reviewHiringRequest(hiringRequestId, body);
  }

  @Post("hiring-requests/:hiringRequestId/link-job")
  @RequirePermissions(Permissions.HiringRequestManage)
  @AuditedAction("hiring_request.link_job", "hiring_request")
  linkJob(@Param("hiringRequestId") hiringRequestId: string, @Body() body: LinkHiringRequestJobDto) {
    return this.hiringRequests.linkJob(hiringRequestId, body);
  }

  @Post("applications/:applicationId/technical-approval")
  @RequirePermissions(Permissions.TechnicalApprovalSubmit)
  @AuditedAction("technical_approval.submit", "application")
  submitTechnicalApproval(@Param("applicationId") applicationId: string, @Body() body: SubmitTechnicalApprovalDto) {
    return this.hiringRequests.submitTechnicalApproval(applicationId, body);
  }

  @Get("applications/:applicationId/technical-approval")
  @RequirePermissions(Permissions.CandidateRead)
  getTechnicalApproval(@Param("applicationId") applicationId: string) {
    return this.hiringRequests.getTechnicalApproval(applicationId);
  }
}
