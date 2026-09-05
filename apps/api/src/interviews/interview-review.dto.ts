import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class InterviewReviewQueryDto {
  @ApiPropertyOptional({ default: 50, maximum: 100 }) @IsOptional() @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ enum: ["pending", "in_review", "completed"] }) @IsOptional() @IsString() status?: string;
}
export class CompleteInterviewReviewDto {
  @ApiProperty({ type: Object }) @IsObject() humanOverride!: Record<string, unknown>;
  @ApiProperty() @IsString() @MaxLength(4000) overrideRationale!: string;
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) evidenceReferences!: string[];
  @ApiProperty({ type: [Object] }) @IsArray() criterionComparison!: Record<string, unknown>[];
}
export class CandidateComplaintReviewDto {
  @ApiProperty() @IsString() @MaxLength(1024) complaintReference!: string;
  @ApiPropertyOptional({ default: 25 }) @IsOptional() @IsInt() @Min(0) @Max(1000) priority?: number;
}
export class InterviewReviewTaskDto {
  @ApiProperty() id!: string; @ApiProperty() interviewSessionId!: string; @ApiPropertyOptional() evaluationId?: string;
  @ApiProperty({ type: [String] }) reasonCodes!: string[]; @ApiProperty() priority!: number; @ApiProperty() status!: string;
  @ApiProperty({ type: [String] }) evidenceReferences!: string[]; @ApiProperty({ type: [Object] }) criterionComparison!: Record<string, unknown>[];
  @ApiPropertyOptional() overrideRationale?: string; @ApiProperty() createdAt!: string;
}
