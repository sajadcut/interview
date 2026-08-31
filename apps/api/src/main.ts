import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { buildCorsOrigin } from "./common/http/cors";
import { HttpExceptionFilter } from "./common/http/http-exception.filter";
import { JsonLogger } from "./common/logging/json.logger";
import { getEnv } from "./config/env";
import { buildOpenApiDocument } from "./openapi";

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const logger = new JsonLogger();
  const app = await NestFactory.create(AppModule, { logger });
  const corsOrigin = buildCorsOrigin(env.CORS_ORIGIN);

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
    ],
    exposedHeaders: ["x-request-id"],
    credentials: false,
    maxAge: 600,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const document = buildOpenApiDocument(app);
  SwaggerModule.setup("docs", app, document, { jsonDocumentUrl: "openapi.json" });

  await app.listen(env.API_PORT, env.API_HOST);
  logger.log(
    `API listening on http://${env.API_HOST}:${env.API_PORT} · CORS_ORIGIN=${
      corsOrigin === "*" ? "*" : corsOrigin.join(",")
    }`,
    "Bootstrap",
  );
}

void bootstrap();
