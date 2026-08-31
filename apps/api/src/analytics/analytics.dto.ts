import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class FunnelStageDto {
  @ApiProperty() stage!: string;
  @ApiProperty() count!: number;
  @ApiProperty() shareOfApplications!: number;
}

export class FunnelAnalyticsDto {
  @ApiPropertyOptional() jobId?: string;
  @ApiProperty() totalApplications!: number;
  @ApiProperty({ type: [FunnelStageDto] }) stages!: FunnelStageDto[];
  @ApiProperty() completedInterviews!: number;
  @ApiProperty() pendingHumanReviews!: number;
}

export class SourcePerformanceDto {
  @ApiProperty() source!: string;
  @ApiProperty() candidates!: number;
  @ApiPropertyOptional() averagePreInterviewMatchScore?: number;
  @ApiProperty() interviewStageOrLater!: number;
}

export class AnalyticsSummaryDto {
  @ApiProperty({ type: FunnelAnalyticsDto }) funnel!: FunnelAnalyticsDto;
  @ApiProperty({ type: [SourcePerformanceDto] }) sources!: SourcePerformanceDto[];
  @ApiProperty({ description: "Metrics are operational decision support and do not replace human review." })
  governanceNotice!: string;
}
