import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApiStandardErrorResponses } from "../common/http/api-standard-error-responses.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  AcceptOrganizationInvitationDto,
  AcceptOrganizationInvitationResponseDto,
  InviteOrganizationUserDto,
  OrganizationInvitationDto,
  OrganizationUserDto,
  OrganizationUserRoleChangeDto,
  OrganizationUserStatusChangeDto,
  UpdateOrganizationUserRoleDto,
  UpdateOrganizationUserStatusDto,
} from "./organization-users.dto";
import { OrganizationUsersService } from "./organization-users.service";

@ApiTags("organization-users")
@ApiStandardErrorResponses()
@Controller("v1/organization/users")
@RequireTenant()
@RequirePermissions(Permissions.OrganizationManageUsers)
export class OrganizationUsersController {
  constructor(private readonly users: OrganizationUsersService) {}

  @Get()
  @ApiOkResponse({ type: [OrganizationUserDto] })
  listUsers() {
    return this.users.listUsers();
  }

  @Get("invitations")
  @ApiOkResponse({ type: [OrganizationInvitationDto] })
  listInvitations() {
    return this.users.listInvitations();
  }

  @Post("invitations")
  @ApiOkResponse({ type: OrganizationInvitationDto })
  invite(@Body() body: InviteOrganizationUserDto) {
    return this.users.invite(body);
  }

  @Patch(":userId/role")
  @ApiOkResponse({ type: OrganizationUserRoleChangeDto })
  changeRole(@Param("userId") userId: string, @Body() body: UpdateOrganizationUserRoleDto) {
    return this.users.changeRole(userId, body);
  }

  @Patch(":userId/status")
  @ApiOkResponse({ type: OrganizationUserStatusChangeDto })
  changeStatus(@Param("userId") userId: string, @Body() body: UpdateOrganizationUserStatusDto) {
    return this.users.setStatus(userId, body);
  }

  @Delete(":userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: "Organization membership removed; global user account is retained." })
  remove(@Param("userId") userId: string) {
    return this.users.remove(userId);
  }
}

@ApiTags("organization-invitations")
@ApiStandardErrorResponses()
@Controller("v1/organization-invitations")
export class OrganizationInvitationsController {
  constructor(private readonly users: OrganizationUsersService) {}

  @Post("accept")
  @ApiOkResponse({ type: AcceptOrganizationInvitationResponseDto })
  accept(@Body() body: AcceptOrganizationInvitationDto) {
    return this.users.acceptInvitation(body);
  }
}
