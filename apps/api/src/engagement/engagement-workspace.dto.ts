import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class EngagementConversationDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiPropertyOptional({ format: "uuid", nullable: true }) candidate_id?: string | null;
  @ApiPropertyOptional({ format: "uuid", nullable: true }) application_id?: string | null;
  @ApiProperty() channel!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ nullable: true }) candidate_name?: string | null;
  @ApiPropertyOptional({ format: "uuid", nullable: true }) latest_message_id?: string | null;
  @ApiPropertyOptional({ nullable: true }) latest_direction?: string | null;
  @ApiPropertyOptional({ nullable: true }) latest_body?: string | null;
  @ApiPropertyOptional({ nullable: true }) latest_approval_state?: string | null;
  @ApiPropertyOptional({ nullable: true }) latest_delivery_status?: string | null;
}

export class EngagementScreeningDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) application_id!: string;
  @ApiPropertyOptional({ nullable: true }) candidate_name?: string | null;
  @ApiPropertyOptional({ nullable: true }) job_title?: string | null;
  @ApiPropertyOptional({ nullable: true }) recommendation?: string | null;
  @ApiProperty() review_state!: string;
}

export class EngagementSchedulingDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) application_id!: string;
  @ApiPropertyOptional({ nullable: true }) candidate_name?: string | null;
  @ApiPropertyOptional({ nullable: true }) job_title?: string | null;
  @ApiProperty() interview_type!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ format: "date-time", nullable: true }) selected_start?: string | null;
}

export class EngagementNotificationDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiPropertyOptional({ nullable: true }) candidate_name?: string | null;
  @ApiProperty() notification_type!: string;
  @ApiProperty() channel!: string;
  @ApiProperty() status!: string;
}

export class EngagementKnowledgeDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() knowledge_type!: string;
  @ApiProperty() status!: string;
}

export class EngagementWorkspacePolicyDto {
  @ApiProperty() candidateFactsRequireApprovedKnowledge!: boolean;
  @ApiProperty() screeningRequiresHumanReview!: boolean;
  @ApiProperty() externalDeliveryRequiresConfiguredProvider!: boolean;
}

export class EngagementWorkspaceDto {
  @ApiProperty({ type: [EngagementConversationDto] }) conversations!: EngagementConversationDto[];
  @ApiProperty({ type: [EngagementScreeningDto] }) screening!: EngagementScreeningDto[];
  @ApiProperty({ type: [EngagementSchedulingDto] }) scheduling!: EngagementSchedulingDto[];
  @ApiProperty({ type: [EngagementNotificationDto] }) notifications!: EngagementNotificationDto[];
  @ApiProperty({ type: [EngagementKnowledgeDto] }) knowledge!: EngagementKnowledgeDto[];
  @ApiProperty({ type: EngagementWorkspacePolicyDto }) policy!: EngagementWorkspacePolicyDto;
}
