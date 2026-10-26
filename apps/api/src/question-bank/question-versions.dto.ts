import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from "class-validator";

export class CreateBankQuestionDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID() documentId!: string;

  @ApiProperty({ minLength: 12, maxLength: 600 })
  @IsString() @MinLength(12) @MaxLength(600) questionText!: string;

  @ApiProperty({ description: "Verbatim excerpt from the selected reference document" })
  @IsString() @MinLength(12) @MaxLength(600) sourceExcerpt!: string;

  @ApiPropertyOptional({ description: "Existing organization taxonomy skill key" })
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,159}$/) skillKey?: string;
}
export class ReviseBankQuestionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minLength: 12, maxLength: 600 })
  @IsString() @MinLength(12) @MaxLength(600) questionText!: string;
  @ApiProperty() @IsString() @MinLength(12) @MaxLength(600) sourceExcerpt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,159}$/) skillKey?: string;
}
export class ReviewBankQuestionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ enum: ["approved","rejected"] })
  @IsIn(["approved","rejected"]) decision!: "approved" | "rejected";
  @ApiProperty({ minLength: 8, maxLength: 1000 })
  @IsString() @MinLength(8) @MaxLength(1000) reason!: string;
}
export class BankQuestionDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) jobId!: string;
  @ApiProperty({ format: "uuid" }) documentId!: string;
  @ApiProperty({ format: "uuid" }) versionId!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty() questionText!: string;
  @ApiProperty() sourceExcerpt!: string;
  @ApiPropertyOptional() skillKey?: string;
  @ApiProperty({ enum: ["pending","approved","rejected"] }) reviewState!: string;
  @ApiProperty() origin!: string;
}
export class BankQuestionReviewDto {
  @ApiProperty({ format: "uuid" }) questionId!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty() decision!: string;
  @ApiProperty({ format: "uuid" }) reviewerUserId!: string;
}
