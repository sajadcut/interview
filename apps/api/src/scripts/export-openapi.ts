import "reflect-metadata";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { buildOpenApiDocument } from "../openapi";

async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  const document = buildOpenApiDocument(app);
  const outputDir = resolve(process.cwd(), "../../openapi");
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "openapi.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await app.close();
}

void exportOpenApi();
