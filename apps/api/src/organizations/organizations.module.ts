import { Module } from "@nestjs/common";
import {
  OrganizationInvitationsController,
  OrganizationUsersController,
} from "./organization-users.controller";
import { OrganizationUsersService } from "./organization-users.service";

@Module({
  controllers: [OrganizationUsersController, OrganizationInvitationsController],
  providers: [OrganizationUsersService],
  exports: [OrganizationUsersService],
})
export class OrganizationsModule {}
