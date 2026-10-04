import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { catchError, Observable, tap, throwError } from "rxjs";
import { getObservabilityConfig, loggableBody, writeStructuredLog } from "./structured-log";

function headersObject(headers: unknown): unknown {
  return headers;
}

@Injectable()
export class HttpTrafficInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const config = getObservabilityConfig();
    if (!config.httpEnabled || context.getType() !== "http") return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = process.hrtime.bigint();

    writeStructuredLog("info", "http.server.request", {
      direction: "inbound",
      protocol: request.protocol,
      method: request.method,
      url: request.originalUrl || request.url,
      route: request.route?.path,
      remoteAddress: request.ip || request.socket?.remoteAddress,
      headers: headersObject(request.headers),
      query: request.query,
      params: request.params,
      body: loggableBody(request.body, request.header("content-type")),
      contentLength: request.header("content-length") ?? undefined,
      userAgent: request.header("user-agent") ?? undefined,
    });

    return next.handle().pipe(
      tap((body) => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        writeStructuredLog("info", "http.server.response", {
          direction: "outbound",
          method: request.method,
          url: request.originalUrl || request.url,
          statusCode: response.statusCode,
          durationMs: Number(durationMs.toFixed(3)),
          headers: response.getHeaders(),
          body: loggableBody(body, String(response.getHeader("content-type") ?? "")),
        });
      }),
      catchError((error: unknown) => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        const statusCode =
          typeof error === "object" &&
          error !== null &&
          "getStatus" in error &&
          typeof (error as { getStatus?: unknown }).getStatus === "function"
            ? Number((error as { getStatus: () => number }).getStatus())
            : response.statusCode >= 400
              ? response.statusCode
              : 500;
        const responseBody =
          typeof error === "object" &&
          error !== null &&
          "getResponse" in error &&
          typeof (error as { getResponse?: unknown }).getResponse === "function"
            ? (error as { getResponse: () => unknown }).getResponse()
            : undefined;

        writeStructuredLog("error", "http.server.error", {
          direction: "outbound",
          method: request.method,
          url: request.originalUrl || request.url,
          statusCode,
          durationMs: Number(durationMs.toFixed(3)),
          error,
          body: loggableBody(responseBody, "application/json"),
        });
        return throwError(() => error);
      }),
    );
  }
}
