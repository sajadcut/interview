import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator";

export class CreateKnowledgeItemDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 48)
  knowledgeType!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 240)
  title!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 12000)
  body!: string;
}

export class ApproveKnowledgeItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  validUntil?: string;
}

export class CreateConversationDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  candidateId!: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @ApiProperty({ enum: ["email", "sms", "in_app", "manual"] })
  @IsIn(["email", "sms", "in_app", "manual"])
  channel!: "email" | "sms" | "in_app" | "manual";
}

export class InboundMessageDto {
  @ApiProperty()
  @IsString()
  @Length(1, 12000)
  body!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  providerReference?: string;
}

export class ApproveOutboundMessageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  providerReference?: string;
}

export class ReviewScreeningDto {
  @ApiProperty({ enum: ["approved", "overridden_advance", "overridden_reject"] })
  @IsIn(["approved", "overridden_advance", "overridden_reject"])
  reviewState!: "approved" | "overridden_advance" | "overridden_reject";

  @ApiProperty()
  @IsString()
  @Length(3, 4000)
  reason!: string;
}

export class CancelSchedulingDto {
  @ApiProperty()
  @IsString()
  @Length(3, 2000)
  reason!: string;
}

export class CreateNotificationDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  candidateId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 64)
  notificationType!: string;

  @ApiProperty({ enum: ["email", "sms", "in_app"] })
  @IsIn(["email", "sms", "in_app"])
  channel!: "email" | "sms" | "in_app";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scheduledFor?: string;

  @ApiProperty()
  @IsObject()
  payload!: Record<string, unknown>;
}

export class RecordNotificationDeliveryDto {
  @ApiProperty()
  @IsString()
  @Length(1, 64)
  provider!: string;

  @ApiProperty({ enum: ["sent", "failed"] })
  @IsIn(["sent", "failed"])
  state!: "sent" | "failed";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  providerReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  errorMessage?: string;
}
