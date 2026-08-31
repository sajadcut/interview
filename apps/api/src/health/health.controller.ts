import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";

@ApiTags("system")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOkResponse({
    schema: {
      example: {
        status: "ok",
        service: "interview-api",
        timestamp: "2026-08-31T00:00:00.000Z",
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
