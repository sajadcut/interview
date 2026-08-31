import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { defineConfig } from "drizzle-kit";

const envCandidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
for (const file of new Set(envCandidates)) {
  if (existsSync(file)) {
    loadEnvFile(file);
    break;
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required for Drizzle commands");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
