import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsIn, IsString, Length } from "class-validator";
import { ORGANIZATION_ROLES } from "./organization-role-policy";
import type { OrganizationRole } from "./membership-role.types";

export class InviteOrganizationUserDto {
  @ApiProperty({ format: "email" })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ORGANIZATION_ROLES })
  @IsIn(ORGANIZATION_ROLES)
  role!: OrganizationRole;
}

export class UpdateOrganizationUserRoleDto {
  @ApiProperty({ enum: ORGANIZATION_ROLES })
  @IsIn(ORGANIZATION_ROLES)
  role!: OrganizationRole;
}

export class UpdateOrganizationUserStatusDto {
  @ApiProperty({ enum: ["active", "disabled"] })
  @IsIn(["active", "disabled"])
  status!: "active" | "disabled";
}

export class AcceptOrganizationInvitationDto {
  @ApiProperty()
  @IsString()
  @Length(32, 512)
  token!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  displayName!: string;

  @ApiProperty({ minLength: 12, maxLength: 128, writeOnly: true })
  @IsString()
  @Length(12, 128)
  password!: string;
}

export class OrganizationUserDto {
  @ApiProperty() userId!: string;
  @ApiProperty() membershipId!: string;
  @ApiProperty() email!: string;
  @ApiPropertyOptional() displayName?: string;
  @ApiProperty({ enum: ["active", "disabled"] }) status!: string;
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiPropertyOptional() lastLoginAt?: string;
}

export class OrganizationInvitationDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: ORGANIZATION_ROLES }) role!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty() deliveryRequired!: boolean;
  @ApiPropertyOptional({ description: "Development-only raw invitation token; never returned in production." })
  developmentToken?: string;
}

export class OrganizationUserRoleChangeDto {
  @ApiProperty() userId!: string;
  @ApiProperty({ enum: ORGANIZATION_ROLES }) role!: string;
}

export class OrganizationUserStatusChangeDto {
  @ApiProperty() userId!: string;
  @ApiProperty({ enum: ["active", "disabled"] }) status!: string;
}

export class AcceptOrganizationInvitationResponseDto {
  @ApiProperty() accepted!: boolean;
  @ApiProperty() organizationId!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() membershipId!: string;
  @ApiProperty({ enum: ORGANIZATION_ROLES }) role!: string;
  @ApiProperty() existingAccount!: boolean;
  @ApiProperty() credentialCreated!: boolean;
}
