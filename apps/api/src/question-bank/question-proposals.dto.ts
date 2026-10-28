import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsUUID, Equals } from "class-validator";

export class GenerateBankQuestionProposalsDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() documentId!: string;
  @ApiProperty({ description: "Explicit confirmation to transmit up to 6000 characters of the selected document to the configured organization-approved LLM", enum: [true] })
  @IsBoolean() @Equals(true) consentToRemoteProcessing!: true;
}

export class GenerateBankQuestionProposalsResponseDto {
  @ApiProperty({ enum: ["ok", "disabled", "unavailable", "no_job_skills", "invalid_output"] })
  status!: "ok" | "disabled" | "unavailable" | "no_job_skills" | "invalid_output";
  @ApiProperty() persistedCount!: number;
}
