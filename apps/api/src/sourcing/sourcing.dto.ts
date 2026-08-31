import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class TalentCandidateDto {
  @ApiProperty() candidateId!: string;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional() currentRole?: string;
  @ApiPropertyOptional() currentCompany?: string;
  @ApiProperty({ type: [String] }) skills!: string[];
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty() status!: string;
  @ApiProperty() updatedAt!: string;
}

export class SourcingRunSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() jobId!: string;
  @ApiProperty() status!: string;
  @ApiProperty() resultCount!: number;
  @ApiPropertyOptional() errorMessage?: string;
  @ApiProperty() createdAt!: string;
}

export class DiscoveredCandidateDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional() candidateId?: string;
  @ApiProperty() sourceType!: string;
  @ApiPropertyOptional() retrievalScore?: number;
  @ApiPropertyOptional() preInterviewMatchScore?: number;
  @ApiProperty() dedupeState!: string;
  @ApiProperty() reviewState!: string;
  @ApiProperty({ type: Object }) profileSnapshot!: Record<string, unknown>;
}

export class SourcingRunDetailDto extends SourcingRunSummaryDto {
  @ApiProperty({ type: Object }) strategy!: Record<string, unknown>;
  @ApiProperty({ type: [DiscoveredCandidateDto] }) results!: DiscoveredCandidateDto[];
  @ApiProperty({ description: "Retrieval scores are search signals, not hiring scores." })
  retrievalNotice!: string;
}

export class SourcingRunRequestDto {
  @ApiProperty() query!: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 }) limit?: number;
}
