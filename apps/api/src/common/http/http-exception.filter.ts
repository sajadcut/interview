import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";

interface RateLimitResponseShape {
  retryAfterSeconds?: unknown;
  limit?: unknown;
  remaining?: unknown;
  resetAt?: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = this.resolveMessage(raw, exception);
    const rateLimit = status === HttpStatus.TOO_MANY_REQUESTS
      ? this.resolveRateLimit(raw)
      : undefined;

    if (rateLimit) {
      response.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      response.setHeader("X-RateLimit-Limit", String(rateLimit.limit));
      response.setHeader("X-RateLimit-Remaining", String(rateLimit.remaining));
      response.setHeader("X-RateLimit-Reset", rateLimit.resetAt);
    }

    // Keep the runtime response aligned with ApiErrorDto/OpenAPI so typed clients can
    // reliably surface actionable backend messages instead of falling back to generic copy.
    // Correlation remains available through the x-request-id response header.
    response.status(status).json({
      message,
      statusCode: status,
      error: this.codeFor(status),
      ...(rateLimit
        ? {
            retryAfterSeconds: rateLimit.retryAfterSeconds,
            limit: rateLimit.limit,
            remaining: rateLimit.remaining,
            resetAt: rateLimit.resetAt,
          }
        : {}),
    });
  }

  private resolveMessage(raw: string | object | undefined, exception: unknown): string {
    if (typeof raw === "string") return raw;
    if (raw && "message" in raw) {
      const value = (raw as { message?: unknown }).message;
      if (Array.isArray(value)) return value.join("; ");
      if (typeof value === "string") return value;
    }
    if (exception instanceof Error && process.env.NODE_ENV !== "production") {
      return exception.message;
    }
    return "An unexpected error occurred";
  }

  private resolveRateLimit(raw: string | object | undefined):
    | { retryAfterSeconds: number; limit: number; remaining: number; resetAt: string }
    | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const value = raw as RateLimitResponseShape;
    const retryAfterSeconds = Number(value.retryAfterSeconds);
    const limit = Number(value.limit);
    const remaining = Number(value.remaining);
    const resetAt = typeof value.resetAt === "string" ? value.resetAt : "";
    if (
      !Number.isFinite(retryAfterSeconds) ||
      retryAfterSeconds < 1 ||
      !Number.isFinite(limit) ||
      limit < 1 ||
      !Number.isFinite(remaining) ||
      remaining < 0 ||
      !resetAt
    ) {
      return undefined;
    }
    return {
      retryAfterSeconds: Math.ceil(retryAfterSeconds),
      limit: Math.trunc(limit),
      remaining: Math.trunc(remaining),
      resetAt,
    };
  }

  private codeFor(status: number): string {
    if (status === 400) return "BAD_REQUEST";
    if (status === 401) return "UNAUTHORIZED";
    if (status === 403) return "FORBIDDEN";
    if (status === 404) return "NOT_FOUND";
    if (status === 409) return "CONFLICT";
    if (status === 422) return "UNPROCESSABLE_ENTITY";
    if (status === 429) return "RATE_LIMITED";
    return status >= 500 ? "INTERNAL_ERROR" : `HTTP_${status}`;
  }
}
