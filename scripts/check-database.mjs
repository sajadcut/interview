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

const versionResult = spawnSync("psql", ["--version"], {
  encoding: "utf8",
  shell: false,
});

if (versionResult.error?.code === "ENOENT" || versionResult.status !== 0) {
  console.error("PostgreSQL client 'psql' is not available on PATH.");
  console.error("Install/configure local PostgreSQL before running database validation. Frontend/static quality checks can proceed without it.");
  process.exit(1);
}

console.log(`✓ ${(versionResult.stdout || versionResult.stderr).trim()}`);

const result = spawnSync(
  "psql",
  [databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", "select current_database(), current_user;"],
  { encoding: "utf8", shell: false },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  console.error((result.stderr || result.stdout || "PostgreSQL connectivity check failed").trim());
  process.exit(result.status ?? 1);
}

console.log(result.stdout.trim());
