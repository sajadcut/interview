import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/http/http-exception.filter";
import { JsonLogger } from "./common/logging/json.logger";
import { getEnv } from "./config/env";
import { buildOpenApiDocument } from "./openapi";

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const logger = new JsonLogger();
  const app = await NestFactory.create(AppModule, { logger });

  app.enableShutdownHooks();
  app.enableCors({ origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()) });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const document = buildOpenApiDocument(app);
  SwaggerModule.setup("docs", app, document, { jsonDocumentUrl: "openapi.json" });

  await app.listen(env.API_PORT);
  logger.log(`API listening on http://localhost:${env.API_PORT}`, "Bootstrap");
}

void bootstrap();
