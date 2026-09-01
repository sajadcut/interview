import { Controller, Get, Header } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import { MetricsService } from "./metrics.service";

@ApiTags("system")
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  @ApiExcludeEndpoint()
  metricsText(): string {
    return this.metrics.renderPrometheus();
  }
}
