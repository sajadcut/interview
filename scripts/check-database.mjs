import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) loadEnvFile(envFile);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required. Copy .env.example to .env and set local credentials.");
  process.exit(1);
}

const result = spawnSync(
  "psql",
  [databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", "select current_database(), current_user;"],
  { encoding: "utf8", shell: process.platform === "win32" },
);

if (result.status !== 0) {
  console.error((result.stderr || result.stdout || "PostgreSQL connectivity check failed").trim());
  process.exit(result.status ?? 1);
}

console.log(result.stdout.trim());
