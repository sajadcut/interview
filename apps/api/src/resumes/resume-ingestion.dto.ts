import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsUUID } from "class-validator";

export class UploadResumeFormDto {
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  applicationId?: string;
}

export class ResumeSkillDto {
  @ApiProperty({ type: String }) key!: string;
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ type: Number }) confidence!: number;
}

export class ResumeExperienceDto {
  @ApiProperty({ type: String }) company!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) startedOn!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) endedOn!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: Number }) confidence!: number;
}

export class ResumeStructuredProfileDto {
  @ApiPropertyOptional({ type: String, nullable: true }) email!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) phone!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) location!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, enum: ["fa", "en"] }) preferredLanguage!: "fa" | "en" | null;
  @ApiPropertyOptional({ type: String, nullable: true }) currentRole!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) currentCompany!: string | null;
  @ApiProperty({ type: ResumeSkillDto, isArray: true }) skills!: ResumeSkillDto[];
  @ApiProperty({ type: ResumeExperienceDto, isArray: true }) experiences!: ResumeExperienceDto[];
  @ApiProperty({ type: String }) parserVersion!: string;
}

export class ResumeDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiProperty({ type: String, format: "uuid" }) candidateId!: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) applicationId!: string | null;
  @ApiProperty({ type: String, enum: ["uploaded", "extracting", "parsing", "completed", "failed"] }) status!: string;
  @ApiProperty({ type: String }) originalFilename!: string;
  @ApiProperty({ type: String }) contentType!: string;
  @ApiProperty({ type: Number }) byteSize!: number;
  @ApiProperty({ type: String }) sha256!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) failureCode!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) failureMessage!: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) pageCount!: number | null;
  @ApiProperty({ type: Number }) chunkCount!: number;
  @ApiProperty({ type: Number }) embeddedChunkCount!: number;
  @ApiProperty({ type: Number }) evidenceCount!: number;
  @ApiProperty({ type: ResumeStructuredProfileDto }) structuredProfile!: ResumeStructuredProfileDto;
  @ApiPropertyOptional({ type: String, nullable: true }) processedAt!: string | null;
  @ApiProperty({ type: String }) createdAt!: string;
}

export class ResumeReadReferenceDto {
  @ApiProperty({ type: String }) url!: string;
}
