import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuditedAction } from "../audit/audited-action.decorator";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  PrivacyRequestDto,
  PrivacyRequestInputDto,
  PrivacyRequestReviewDto,
  RetentionPolicyDto,
  RetentionPolicyInputDto,
} from "./privacy.dto";
import { PrivacyService } from "./privacy.service";

@ApiTags("privacy")
@Controller("v1/privacy")
@RequireTenant()
@RequirePermissions(Permissions.PrivacyManage)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get("retention-policies")
  @ApiOkResponse({ type: RetentionPolicyDto, isArray: true })
  listRetentionPolicies() {
    return this.privacy.listRetentionPolicies();
  }

  @Post("retention-policies")
  @AuditedAction("privacy.retention_policy.upsert", "retention_policy")
  @ApiOkResponse({ type: RetentionPolicyDto })
  upsertRetentionPolicy(@Body() body: RetentionPolicyInputDto) {
    return this.privacy.upsertRetentionPolicy(body);
  }

  @Get("requests")
  @ApiOkResponse({ type: PrivacyRequestDto, isArray: true })
  listPrivacyRequests(@Query("status") status?: string) {
    return this.privacy.listPrivacyRequests(status);
  }

  @Post("requests")
  @AuditedAction("privacy.request.create", "privacy_request")
  @ApiOkResponse({ type: PrivacyRequestDto })
  createPrivacyRequest(@Body() body: PrivacyRequestInputDto) {
    return this.privacy.createPrivacyRequest(body);
  }

  @Patch("requests/:requestId/review")
  @AuditedAction("privacy.request.review", "privacy_request")
  @ApiOkResponse({ type: PrivacyRequestDto })
  reviewPrivacyRequest(
    @Param("requestId") requestId: string,
    @Body() body: PrivacyRequestReviewDto,
  ) {
    return this.privacy.reviewPrivacyRequest(requestId, body);
  }
}
