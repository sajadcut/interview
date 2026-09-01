import { ApiProperty } from "@nestjs/swagger";

export class InterviewEvaluatorInputDto {
  @ApiProperty() schemaVersion!: string;
  @ApiProperty() sessionId!: string;
  @ApiProperty() applicationId!: string;
  @ApiProperty() sessionStatus!: string;
  @ApiProperty() rubricVersionId!: string;
  @ApiProperty() planVersion!: number;
  @ApiProperty() evaluatorVersion!: string;
  @ApiProperty({ type: [Object] }) criteria!: Record<string, unknown>[];
  @ApiProperty({ type: [Object] }) transcript!: Record<string, unknown>[];
  @ApiProperty({ type: [Object] }) evidence!: Record<string, unknown>[];
  @ApiProperty({ type: Object }) boundaries!: {
    evidenceOnly: boolean;
    unsupportedInference: string;
    recommendationIsDecisionSupport: boolean;
    finalHiringAuthority: string;
  };
}
