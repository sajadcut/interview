import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ApiErrorDto {
  @ApiProperty({ example: "Request could not be processed" })
  message!: string;

  @ApiPropertyOptional({ example: 400 })
  statusCode?: number;

  @ApiPropertyOptional({ example: "Bad Request" })
  error?: string;
}
