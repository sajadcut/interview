import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class RetentionPolicyInputDto {
  @ApiProperty() entityType!: string;
  @ApiProperty({ minimum: 1 }) retentionDays!: number;
  @ApiProperty({ default: true }) enabled!: boolean;
  @ApiPropertyOptional({ type: Object }) legalHoldRules?: Record<string, unknown>;
}

export class RetentionPolicyDto extends RetentionPolicyInputDto {
  @ApiProperty() id!: string;
  @ApiProperty() updatedAt!: string;
}

export class PrivacyRequestInputDto {
  @ApiProperty() candidateId!: string;
  @ApiProperty({ enum: ["access", "deletion", "withdraw_consent"] })
  requestType!: "access" | "deletion" | "withdraw_consent";
  @ApiPropertyOptional({ type: Object }) metadata?: Record<string, unknown>;
}

export class PrivacyRequestReviewDto {
  @ApiProperty({ enum: ["approve", "reject"] }) decision!: "approve" | "reject";
  @ApiProperty() reviewNotes!: string;
}

export class PrivacyRequestDto {
  @ApiProperty() id!: string;
  @ApiProperty() candidateId!: string;
  @ApiProperty() requestType!: string;
  @ApiProperty() status!: string;
  @ApiProperty() requestedAt!: string;
  @ApiPropertyOptional() reviewNotes?: string;
  @ApiPropertyOptional() completedAt?: string;
  @ApiProperty({ type: Object }) metadata!: Record<string, unknown>;
}
