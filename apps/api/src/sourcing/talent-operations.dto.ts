import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator";

export class UpsertTalentEntryDto {
  @ApiPropertyOptional({ enum: ["active", "archived", "do_not_contact"] })
  @IsOptional()
  @IsIn(["active", "archived", "do_not_contact"])
  status?: "active" | "archived" | "do_not_contact";

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ResolveDuplicateReviewDto {
  @ApiProperty({ enum: ["accepted", "rejected"] })
  @IsIn(["accepted", "rejected"])
  decision!: "accepted" | "rejected";

  @ApiProperty()
  @IsString()
  @Length(3, 4000)
  reason!: string;
}

export class CandidateMatchRequestDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  candidateId!: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  applicationId?: string;
}
