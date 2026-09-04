import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length } from "class-validator";

export class AtsJobLinkDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 512 })
  @IsString()
  @Length(1, 512)
  providerJobReference!: string;
}

export class AtsStageUpdateDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 512 })
  @IsString()
  @Length(1, 512)
  targetStageReference!: string;

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 512 })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  currentStageReference?: string;
}

export class AtsProviderStatusDto {
  @ApiProperty({ enum: ["greenhouse", "lever"] }) provider!: string;
  @ApiProperty({ type: String }) implementation!: string;
  @ApiProperty({ type: Boolean }) configured!: boolean;
  @ApiProperty({ type: String }) connectionStatus!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) credentialReference?: string | null;
  @ApiProperty({ type: Object, additionalProperties: true }) config!: Record<string, unknown>;
}

export class AtsVerifyResponseDto {
  @ApiProperty({ enum: ["greenhouse", "lever"] }) provider!: string;
  @ApiProperty({ type: Boolean }) ready!: boolean;
  @ApiProperty({ type: String, format: "date-time" }) verifiedAt!: string;
}

export class AtsJobDto {
  @ApiProperty({ enum: ["greenhouse", "lever"] }) provider!: string;
  @ApiProperty({ type: String }) externalId!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) status!: string;
  @ApiPropertyOptional({ type: String }) location?: string;
  @ApiPropertyOptional({ type: String }) department?: string;
  @ApiPropertyOptional({ type: String }) sourceUrl?: string;
}

export class AtsJobLinkResponseDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) provider_key!: string;
  @ApiProperty({ type: String }) job_id!: string;
  @ApiProperty({ type: String }) provider_job_reference!: string;
  @ApiProperty({ type: String, format: "date-time" }) updated_at!: string;
}

export class AtsApplicationLinkDto {
  @ApiProperty({ type: String }) provider_key!: string;
  @ApiProperty({ type: String }) provider_job_reference!: string;
  @ApiProperty({ type: String }) provider_candidate_reference!: string;
  @ApiProperty({ type: String }) provider_application_reference!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) remote_stage_reference?: string | null;
  @ApiProperty({ type: String }) sync_state!: string;
  @ApiProperty({ type: String, format: "date-time" }) last_synced_at!: string;
  @ApiProperty({ type: String, format: "date-time" }) created_at!: string;
  @ApiProperty({ type: String, format: "date-time" }) updated_at!: string;
}
