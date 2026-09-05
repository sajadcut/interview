import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from "class-validator";
import {
  InterviewSessionTransitionActions,
  type InterviewSessionTransitionAction,
} from "./interview-session-state-machine";

export class InterviewSessionTransitionInputDto {
  @IsString()
  @Length(8, 200)
  idempotencyKey!: string;

  @IsIn(InterviewSessionTransitionActions)
  action!: InterviewSessionTransitionAction;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  failureCode?: string;

  @IsOptional()
  @IsBoolean()
  recoverable?: boolean;
}
