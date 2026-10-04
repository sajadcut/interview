import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { assertProductionCorsPolicy, buildCorsOrigin } from "./common/http/cors";
import { HttpExceptionFilter } from "./common/http/http-exception.filter";
import { JsonLogger } from "./common/logging/json.logger";
import { installInstrumentedFetch } from "./common/observability/instrumented-fetch";
import { getObservabilityConfig, logFilePath, writeStructuredLog } from "./common/observability/structured-log";
import { assertProductionSecretPolicy } from "./common/security/secrets";
import { getEnv } from "./config/env";
import { buildOpenApiDocument } from "./openapi";

async function bootstrap(): Promise<void> {
  const env = getEnv();
  assertProductionSecretPolicy(process.env);
  // Install once so every server-side fetch (LLM/RAG/sourcing/media/internal HTTP) is trace-logged.
  installInstrumentedFetch();
  const logger = new JsonLogger();
  const app = await NestFactory.create(AppModule, { logger });
  const corsOrigin = buildCorsOrigin(env.CORS_ORIGIN);
  assertProductionCorsPolicy(env.NODE_ENV, corsOrigin);

  app.enableShutdownHooks();
  app.enableCors({
    origin: corsOrigin,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "authorization",
      "x-organization-id",
      "x-user-id",
      "x-request-id",
      "x-trace-id",
      "traceparent",
    ],
    exposedHeaders: [
      "x-request-id",
      "x-trace-id",
      "traceparent",
      "retry-after",
      "x-ratelimit-limit",
      "x-ratelimit-remaining",
      "x-ratelimit-reset",
    ],
    credentials: corsOrigin !== "*",
    maxAge: 600,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const document = buildOpenApiDocument(app);
  SwaggerModule.setup("docs", app, document, { jsonDocumentUrl: "openapi.json" });

  await app.listen(env.API_PORT, env.API_HOST);
  const observability = getObservabilityConfig();
  writeStructuredLog("info", "application.started", {
    host: env.API_HOST,
    port: env.API_PORT,
    corsOrigin: corsOrigin === "*" ? "*" : corsOrigin,
    logFile: logFilePath(),
    logLevel: observability.level,
    logBodyMode: observability.bodyMode,
    outboundHttpLogging: observability.outboundEnabled,
  });
  logger.log(
    `API listening on http://${env.API_HOST}:${env.API_PORT} · logs=${logFilePath()}`,
    "Bootstrap",
  );
}

void bootstrap();
