import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ApprovedSourceTypes, type ApprovedSourceType } from "./candidate-source.adapter";

const sourceTypes = Object.values(ApprovedSourceTypes);

export class SourcingImportCandidateDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  candidateId?: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  sourceExternalKey?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 240)
  displayName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 240)
  currentRole?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 240)
  currentCompany?: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  skills!: string[];

  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  retrievalScore?: number;

  @ApiProperty({ type: [String], description: "Stable source references supporting the imported profile." })
  @IsArray()
  @IsString({ each: true })
  evidenceReferences!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  normalizedEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  normalizedPhone?: string;

  @ApiProperty({ format: "date-time" })
  @IsString()
  observedAt!: string;

  @ApiPropertyOptional({ format: "uri" })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  sourceUrl?: string;
}

export class SourcingImportRequestDto {
  @ApiProperty({ enum: sourceTypes })
  @IsIn(sourceTypes)
  sourceType!: ApprovedSourceType;

  @ApiProperty({ description: "Stable provider/importer key, for example greenhouse, lever or csv-import." })
  @IsString()
  @Length(2, 120)
  providerKey!: string;

  @ApiPropertyOptional({ description: "Required for non-internal source imports." })
  @IsOptional()
  @IsBoolean()
  approvalConfirmed?: boolean;

  @ApiProperty({ type: [SourcingImportCandidateDto], minItems: 1, maxItems: 500 })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SourcingImportCandidateDto)
  candidates!: SourcingImportCandidateDto[];
}

export class SourcingImportResultDto {
  @ApiProperty() runId!: string;
  @ApiProperty() importedCount!: number;
  @ApiProperty() sourceType!: string;
  @ApiProperty() providerKey!: string;
  @ApiProperty() status!: string;
}

export class SourcingExportDto {
  @ApiProperty() schemaVersion!: string;
  @ApiProperty() exportedAt!: string;
  @ApiProperty({ type: Object }) run!: Record<string, unknown>;
  @ApiProperty({ type: [Object] }) attempts!: Record<string, unknown>[];
  @ApiProperty({ type: [Object] }) candidates!: Record<string, unknown>[];
}

export class SourcingAuditDto {
  @ApiProperty() runId!: string;
  @ApiProperty() sourcePolicyVersion!: string;
  @ApiProperty() attemptCount!: number;
  @ApiProperty() resultCount!: number;
  @ApiProperty() provenanceComplete!: boolean;
  @ApiProperty() missingProvenanceCount!: number;
  @ApiProperty() missingEvidenceReferenceCount!: number;
  @ApiProperty({ type: [String] }) providerKeys!: string[];
  @ApiProperty({ type: [Object] }) attempts!: Record<string, unknown>[];
}
