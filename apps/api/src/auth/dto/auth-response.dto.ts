import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class AuthOrganizationDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ type: [String] }) roles!: string[];
}

export class AuthUserDto {
  @ApiProperty() id!: string;
  @ApiProperty({ format: "email" }) email!: string;
  @ApiPropertyOptional({ nullable: true }) displayName?: string | null;
}

export class AuthSessionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ format: "date-time" }) expiresAt!: string;
}

export class LoginResponseDto {
  @ApiProperty({ type: AuthUserDto }) user!: AuthUserDto;
  @ApiProperty({ type: AuthSessionDto }) session!: AuthSessionDto;
  @ApiProperty({ type: [AuthOrganizationDto] }) organizations!: AuthOrganizationDto[];
}

export class RefreshResponseDto {
  @ApiProperty({ type: AuthSessionDto }) session!: AuthSessionDto;
}

export class SessionResponseDto {
  @ApiProperty() userId!: string;
  @ApiPropertyOptional() sessionId?: string;
  @ApiProperty({ type: [AuthOrganizationDto] }) organizations!: AuthOrganizationDto[];
}

export class PasswordResetRequestResponseDto {
  @ApiProperty() accepted!: boolean;
  @ApiProperty() deliveryRequired!: boolean;
  @ApiPropertyOptional({ description: "Development-only token; never returned in production." })
  developmentToken?: string;
}

export class PasswordResetCompleteResponseDto {
  @ApiProperty() reset!: boolean;
}
