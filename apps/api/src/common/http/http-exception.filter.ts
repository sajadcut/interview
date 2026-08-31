import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { RequestWithContext } from "./correlation-id.middleware";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<RequestWithContext>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = this.resolveMessage(raw, exception);

    response.status(status).json({
      error: {
        code: this.codeFor(status),
        message,
        requestId: request.requestId ?? null,
        timestamp: new Date().toISOString(),
        path: (request as Request).originalUrl,
      },
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

  private codeFor(status: number): string {
    if (status === 400) return "BAD_REQUEST";
    if (status === 401) return "UNAUTHORIZED";
    if (status === 403) return "FORBIDDEN";
    if (status === 404) return "NOT_FOUND";
    if (status === 409) return "CONFLICT";
    if (status === 422) return "UNPROCESSABLE_ENTITY";
    return status >= 500 ? "INTERNAL_ERROR" : `HTTP_${status}`;
  }
}
