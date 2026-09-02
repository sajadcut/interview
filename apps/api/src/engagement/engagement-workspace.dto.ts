import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class EngagementConversationDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) candidate_id?: string | null;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) application_id?: string | null;
  @ApiProperty({ type: String }) channel!: string;
  @ApiProperty({ type: String }) status!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) candidate_name?: string | null;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) latest_message_id?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) latest_direction?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) latest_body?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) latest_approval_state?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) latest_delivery_status?: string | null;
}

export class EngagementScreeningDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiProperty({ type: String, format: "uuid" }) application_id!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) candidate_name?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) job_title?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) recommendation?: string | null;
  @ApiProperty({ type: String }) review_state!: string;
}

export class EngagementSchedulingDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiProperty({ type: String, format: "uuid" }) application_id!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) candidate_name?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) job_title?: string | null;
  @ApiProperty({ type: String }) interview_type!: string;
  @ApiProperty({ type: String }) status!: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) selected_start?: string | null;
}

export class EngagementNotificationDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) candidate_name?: string | null;
  @ApiProperty({ type: String }) notification_type!: string;
  @ApiProperty({ type: String }) channel!: string;
  @ApiProperty({ type: String }) status!: string;
}

export class EngagementKnowledgeDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String }) knowledge_type!: string;
  @ApiProperty({ type: String }) status!: string;
}

export class EngagementWorkspacePolicyDto {
  @ApiProperty({ type: Boolean }) candidateFactsRequireApprovedKnowledge!: boolean;
  @ApiProperty({ type: Boolean }) screeningRequiresHumanReview!: boolean;
  @ApiProperty({ type: Boolean }) externalDeliveryRequiresConfiguredProvider!: boolean;
}

export class EngagementWorkspaceDto {
  @ApiProperty({ type: [EngagementConversationDto] }) conversations!: EngagementConversationDto[];
  @ApiProperty({ type: [EngagementScreeningDto] }) screening!: EngagementScreeningDto[];
  @ApiProperty({ type: [EngagementSchedulingDto] }) scheduling!: EngagementSchedulingDto[];
  @ApiProperty({ type: [EngagementNotificationDto] }) notifications!: EngagementNotificationDto[];
  @ApiProperty({ type: [EngagementKnowledgeDto] }) knowledge!: EngagementKnowledgeDto[];
  @ApiProperty({ type: EngagementWorkspacePolicyDto }) policy!: EngagementWorkspacePolicyDto;
}
