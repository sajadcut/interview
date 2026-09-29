import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateHiringRequestDto {
  @ApiProperty() @IsString() @Length(1, 240) title!: string;
  @ApiProperty() @IsString() @Length(1, 160) hiringTeam!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 160) department?: string;
  @ApiProperty({ minimum: 1, maximum: 100, default: 1 }) @IsInt() @Min(1) @Max(100) headcount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) seniority?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 240) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) employmentType?: string;
  @ApiProperty() @IsString() @Length(3, 4000) businessReason!: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) requirements!: string[];
}

export class ReviewHiringRequestDto {
  @ApiProperty({ enum: ["approve", "reject"] }) @IsIn(["approve", "reject"]) decision!: "approve" | "reject";
  @ApiProperty() @IsString() @Length(3, 4000) note!: string;
}

export class LinkHiringRequestJobDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() jobId!: string;
}

export class SubmitTechnicalApprovalDto {
  @ApiProperty({ enum: ["approve", "needs_interview", "reject"] })
  @IsIn(["approve", "needs_interview", "reject"])
  decision!: "approve" | "needs_interview" | "reject";

  @ApiProperty() @IsString() @Length(3, 4000) feedback!: string;
}
