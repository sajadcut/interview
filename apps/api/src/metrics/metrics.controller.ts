import { Controller, Get, Header } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import { OperationalMetricsService } from "./operational-metrics.service";

@ApiTags("system")
@Controller()
export class MetricsController {
  constructor(private readonly metrics: OperationalMetricsService) {}

  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  @Header("cache-control", "no-store")
  @ApiExcludeEndpoint()
  async metricsText(): Promise<string> {
    return this.metrics.renderPrometheus();
  }
}
