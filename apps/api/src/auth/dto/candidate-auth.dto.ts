import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsUUID, Length, Matches } from "class-validator";

export class CreateCandidateInvitationDto {
  @ApiProperty()
  @IsUUID()
  applicationId!: string;
}

export class ValidateCandidateMagicLinkDto {
  @ApiProperty()
  @IsString()
  @Length(32, 512)
  token!: string;
}

export class VerifyCandidateOtpDto {
  @ApiProperty()
  @IsString()
  @Length(32, 512)
  token!: string;

  @ApiProperty({ pattern: "^[0-9]{6}$" })
  @Matches(/^[0-9]{6}$/)
  otp!: string;
}

export class CandidateInvitationResponseDto {
  @ApiProperty() invitationId!: string;
  @ApiProperty() otpChallengeId!: string;
  @ApiProperty() maskedEmail!: string;
  @ApiProperty() expiresAt!: string;
  @ApiProperty() deliveryRequired!: boolean;
  @ApiProperty({ type: Object }) candidate!: { displayName: string; jobTitle: string };
  @ApiPropertyOptional({ description: "Development-only magic-link token." }) developmentToken?: string;
  @ApiPropertyOptional({ description: "Development-only OTP." }) developmentOtp?: string;
}

export class CandidateMagicLinkValidationDto {
  @ApiProperty() valid!: boolean;
  @ApiProperty() invitationId!: string;
  @ApiProperty() applicationId!: string;
  @ApiProperty() maskedEmail!: string;
  @ApiProperty() candidateDisplayName!: string;
  @ApiProperty() jobTitle!: string;
  @ApiProperty() expiresAt!: string;
  @ApiProperty() otpRequired!: boolean;
}

export class CandidateAuthenticationResponseDto {
  @ApiProperty() authenticated!: boolean;
  @ApiProperty() sessionId!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() candidateId!: string;
  @ApiProperty() applicationId!: string;
  @ApiProperty() expiresAt!: string;
}

export class CandidateSessionDto {
  @ApiProperty() organizationId!: string;
  @ApiProperty() sessionId!: string;
  @ApiProperty() candidateId!: string;
  @ApiProperty() applicationId!: string;
  @ApiProperty() expiresAt!: string;
  @ApiProperty() candidateDisplayName!: string;
  @ApiProperty() jobTitle!: string;
  @ApiProperty() applicationStatus!: string;
  @ApiProperty() pipelineStage!: string;
}
