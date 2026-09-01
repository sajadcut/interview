import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { IsIanaTimezone } from "./timezone";

export class OutboundMessageRequestDto {
  @ApiProperty()
  @IsString()
  @Length(1, 10000)
  body!: string;

  @ApiProperty({ type: [String], description: "Approved knowledge item UUIDs" })
  @IsArray()
  @IsString({ each: true })
  groundingReferences!: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  autoSendRequested?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  autoSendPolicyEnabled?: boolean;
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

export class SchedulingSlotDto {
  @ApiProperty() start!: string;
  @ApiProperty() end!: string;
}

export class SchedulingRequestInputDto {
  @ApiProperty()
  @IsString()
  @Length(1, 160)
  interviewType!: string;

  @ApiProperty({ example: "Europe/Berlin" })
  @IsString()
  @IsIanaTimezone()
  timezone!: string;

  @ApiProperty({ type: [SchedulingSlotDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => SchedulingSlotDto)
  proposedSlots!: SchedulingSlotDto[];
}

export class SchedulingConfirmationDto {
  @ApiProperty()
  @IsString()
  selectedStart!: string;

  @ApiProperty()
  @IsString()
  selectedEnd!: string;
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
