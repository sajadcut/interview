import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from "class-validator";

export class CreateInterviewerProfileDto {
  @ApiProperty({ format: "email" })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  lastName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  jobTitle?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  specialties?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  bio?: string;
}

export class UpdateInterviewerProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  lastName?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  jobTitle?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  specialties?: string[];

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  bio?: string | null;

  @ApiPropertyOptional({ enum: ["active", "disabled"] })
  @IsOptional()
  @IsIn(["active", "disabled"])
  status?: "active" | "disabled";
}

export class InterviewerProfileDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiPropertyOptional() phone?: string;
  @ApiPropertyOptional() jobTitle?: string;
  @ApiProperty({ type: [String] }) specialties!: string[];
  @ApiPropertyOptional() bio?: string;
  @ApiProperty({ enum: ["active", "disabled"] }) status!: string;
  @ApiProperty({ enum: ["active", "pending", "disabled"] }) effectiveStatus!: string;
  @ApiPropertyOptional({ format: "uuid" }) userId?: string;
  @ApiProperty() assignmentCount!: number;
  @ApiProperty() invitationPending!: boolean;
  @ApiProperty({ format: "date-time" }) updatedAt!: string;
}
