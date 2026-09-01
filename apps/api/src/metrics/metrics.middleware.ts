import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { MetricsService } from "./metrics.service";

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    response.once("finish", () => {
      const elapsedNs = process.hrtime.bigint() - startedAt;
      this.metrics.record(
        request.method,
        request.route?.path ? String(request.route.path) : request.path,
        response.statusCode,
        Number(elapsedNs) / 1_000_000,
      );
    });
    next();
  }
}
