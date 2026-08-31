import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/http/http-exception.filter";
import { JsonLogger } from "./common/logging/json.logger";
import { getEnv } from "./config/env";

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

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Interview Platform API")
    .setDescription("Core API for the AI Recruiter platform")
    .setVersion("0.1.0")
    .addBearerAuth()
    .addApiKey({ type: "apiKey", in: "header", name: "x-organization-id" }, "organization")
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document, { jsonDocumentUrl: "openapi.json" });

  await app.listen(env.API_PORT);
  logger.log(`API listening on http://localhost:${env.API_PORT}`, "Bootstrap");
}

void bootstrap();
