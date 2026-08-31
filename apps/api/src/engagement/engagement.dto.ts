import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class OutboundMessageRequestDto {
  @ApiProperty() body!: string;
  @ApiProperty({ type: [String], description: "Approved knowledge item UUIDs" }) groundingReferences!: string[];
  @ApiPropertyOptional({ default: false }) autoSendRequested?: boolean;
  @ApiPropertyOptional({ default: false }) autoSendPolicyEnabled?: boolean;
}

export class MessageDto {
  @ApiProperty() id!: string;
  @ApiProperty() direction!: string;
  @ApiProperty() senderType!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ type: [String] }) groundingReferences!: string[];
  @ApiProperty() approvalState!: string;
  @ApiPropertyOptional() sentAt?: string;
  @ApiProperty() createdAt!: string;
}

export class ConversationDto {
  @ApiProperty() id!: string;
  @ApiProperty() candidateId!: string;
  @ApiPropertyOptional() applicationId?: string;
  @ApiProperty() channel!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ type: [MessageDto] }) messages!: MessageDto[];
}

export class ScreeningRuleDto {
  @ApiProperty() key!: string;
  @ApiProperty() required!: boolean;
  @ApiProperty({ oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] })
  expected!: string | number | boolean;
}

export class ScreeningSessionRequestDto {
  @ApiProperty() rulesVersion!: string;
  @ApiProperty({ type: [ScreeningRuleDto] }) rules!: ScreeningRuleDto[];
  @ApiProperty({ type: Object }) answers!: Record<string, string | number | boolean | null>;
}

export class ScreeningSessionDto {
  @ApiProperty() id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() rulesVersion!: string;
  @ApiProperty() eligible!: boolean;
  @ApiProperty({ type: [String] }) failedRequiredRules!: string[];
  @ApiProperty() recommendation!: string;
  @ApiProperty() reviewState!: string;
  @ApiProperty() createdAt!: string;
}

export class SchedulingRequestInputDto {
  @ApiProperty() interviewType!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ type: [Object] }) proposedSlots!: Record<string, unknown>[];
}

export class SchedulingConfirmationDto {
  @ApiProperty() selectedStart!: string;
  @ApiProperty() selectedEnd!: string;
}

export class SchedulingRequestDto {
  @ApiProperty() id!: string;
  @ApiProperty() applicationId!: string;
  @ApiProperty() interviewType!: string;
  @ApiProperty() status!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ type: [Object] }) proposedSlots!: Record<string, unknown>[];
  @ApiPropertyOptional() selectedStart?: string;
  @ApiPropertyOptional() selectedEnd?: string;
  @ApiPropertyOptional() calendarProvider?: string;
  @ApiPropertyOptional() calendarReference?: string;
  @ApiProperty({ type: Object }) reminderPolicy!: Record<string, unknown>;
  @ApiProperty() createdAt!: string;
}
