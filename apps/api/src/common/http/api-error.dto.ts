import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ApiErrorDto {
  @ApiProperty({ example: "Request could not be processed" })
  message!: string;

  @ApiPropertyOptional({ example: 400 })
  statusCode?: number;

  @ApiPropertyOptional({ example: "Bad Request" })
  error?: string;

  @ApiPropertyOptional({ example: "0123456789abcdef0123456789abcdef" })
  traceId?: string;

  @ApiPropertyOptional({ example: "request-12345678" })
  requestId?: string;
}
