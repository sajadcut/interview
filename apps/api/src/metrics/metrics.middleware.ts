import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { MetricsService } from "./metrics.service";

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    this.metrics.beginRequest();
    let completed = false;
    const finalize = (): void => {
      if (completed) return;
      completed = true;
      this.metrics.endRequest();
      const elapsedNs = process.hrtime.bigint() - startedAt;
      const route = request.route?.path ? String(request.route.path) : "__unmatched__";
      this.metrics.record(request.method, route, response.statusCode, Number(elapsedNs) / 1_000_000);
    };
    response.once("finish", finalize);
    response.once("close", finalize);
    next();
  }
}
