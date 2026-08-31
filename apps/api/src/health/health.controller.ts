import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";

@ApiTags("system")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["status", "service", "timestamp"],
      properties: {
        status: { type: "string", enum: ["ok"] },
        service: { type: "string", example: "interview-api" },
        timestamp: { type: "string", format: "date-time", example: "2026-08-31T00:00:00.000Z" },
      },
    },
  })
  health(): { status: "ok"; service: string; timestamp: string } {
    return {
      status: "ok",
      service: "interview-api",
      timestamp: new Date().toISOString(),
    };
  }
}
