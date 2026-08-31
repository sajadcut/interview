import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import type { INestApplication } from "@nestjs/common";

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Interview Platform API")
    .setDescription("Core API for the AI Recruiter platform")
    .setVersion("0.1.0")
    .addBearerAuth()
    .addApiKey({ type: "apiKey", in: "header", name: "x-organization-id" }, "organization")
    .build();

  return SwaggerModule.createDocument(app, config);
}
