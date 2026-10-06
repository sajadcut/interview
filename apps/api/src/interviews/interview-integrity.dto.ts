import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

export class InterviewIntegrityReviewInputDto {
  @ApiProperty({
    enum: ["reviewed_no_concern", "reviewed_concern", "inconclusive"],
  })
  @IsIn(["reviewed_no_concern", "reviewed_concern", "inconclusive"])
  status!: "reviewed_no_concern" | "reviewed_concern" | "inconclusive";

  @ApiProperty({ minLength: 1, maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  comment!: string;
}
