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
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Permissions } from "../auth/permissions";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { RequireTenant } from "../tenant/require-tenant.decorator";
import {
  AcceptOrganizationInvitationDto,
  InviteOrganizationUserDto,
  OrganizationInvitationDto,
  OrganizationUserDto,
  UpdateOrganizationUserRoleDto,
  UpdateOrganizationUserStatusDto,
} from "./organization-users.dto";
import { OrganizationUsersService } from "./organization-users.service";

@ApiTags("organization-users")
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
  changeRole(@Param("userId") userId: string, @Body() body: UpdateOrganizationUserRoleDto) {
    return this.users.changeRole(userId, body);
  }

  @Patch(":userId/status")
  changeStatus(@Param("userId") userId: string, @Body() body: UpdateOrganizationUserStatusDto) {
    return this.users.setStatus(userId, body);
  }

  @Delete(":userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("userId") userId: string) {
    return this.users.remove(userId);
  }
}

@ApiTags("organization-invitations")
@Controller("v1/organization-invitations")
export class OrganizationInvitationsController {
  constructor(private readonly users: OrganizationUsersService) {}

  @Post("accept")
  accept(@Body() body: AcceptOrganizationInvitationDto) {
    return this.users.acceptInvitation(body);
  }
}
