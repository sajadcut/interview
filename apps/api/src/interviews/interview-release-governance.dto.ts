import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsDateString, IsOptional, IsString, MaxLength } from "class-validator";

export class ApproveInterviewReleaseDto {
  @ApiProperty() @IsString() @MaxLength(120) rubricVersion!: string;
  @ApiProperty() @IsString() @MaxLength(160) promptVersionFamily!: string;
  @ApiProperty() @IsString() @MaxLength(160) validationDatasetVersion!: string;
  @ApiProperty() @IsString() @MaxLength(1024) calibrationReportReference!: string;
  @ApiProperty() @IsString() @MaxLength(1024) securityReviewReference!: string;
  @ApiProperty() @IsString() @MaxLength(1024) privacyComplianceReviewReference!: string;
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) knownLimitations!: string[];
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) rollbackConditions!: string[];
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) suspensionConditions!: string[];
  @ApiProperty() @IsDateString() approvalExpiresAt!: string;
}

export class SuspendInterviewReleaseDto {
  @ApiProperty() @IsString() @MaxLength(4000) reason!: string;
}

export class InterviewReleaseApprovalEventDto {
  @ApiProperty() id!: string;
  @ApiProperty() eventType!: string;
  @ApiPropertyOptional() actorUserId?: string;
  @ApiPropertyOptional() reason?: string;
  @ApiProperty({ type: Object }) artifactSnapshot!: Record<string, unknown>;
  @ApiProperty() createdAt!: string;
}
