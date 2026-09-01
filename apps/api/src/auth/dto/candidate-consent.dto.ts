import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsString, Length } from "class-validator";

export const CandidateConsentTypes = ["privacy_disclosure", "ai_interview", "recording"] as const;
export type CandidateConsentType = (typeof CandidateConsentTypes)[number];

export class RecordCandidateConsentDto {
  @ApiProperty({ enum: CandidateConsentTypes })
  @IsIn(CandidateConsentTypes)
  consentType!: CandidateConsentType;

  @ApiProperty()
  @IsString()
  @Length(1, 80)
  noticeVersion!: string;

  @ApiProperty()
  @IsBoolean()
  granted!: boolean;
}

export class CandidateConsentReceiptDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: CandidateConsentTypes }) consentType!: CandidateConsentType;
  @ApiProperty() noticeVersion!: string;
  @ApiProperty() granted!: boolean;
  @ApiProperty() createdAt!: string;
}

export class CandidateConsentStatusDto {
  @ApiProperty({ type: [CandidateConsentReceiptDto] }) latest!: CandidateConsentReceiptDto[];
  @ApiProperty() readyForInterview!: boolean;
  @ApiProperty({ type: [String] }) missingRequiredConsents!: CandidateConsentType[];
}
