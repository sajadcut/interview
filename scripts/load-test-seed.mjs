import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { integerEnvironment } from "./load-test-lib.mjs";

const root = process.cwd();
const envFile = resolve(root, ".env");
if (existsSync(envFile)) loadEnvFile(envFile);

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required for load-test fixture seeding");
  process.exit(2);
}

const orgSlug = process.env.LOAD_TEST_ORGANIZATION_SLUG?.trim()
  || process.env.DEV_ORGANIZATION_SLUG?.trim()
  || "local-interview";
const userEmail = process.env.LOAD_TEST_USER_EMAIL?.trim()
  || process.env.DEV_USER_EMAIL?.trim()
  || "admin@local.interview";
const candidateCount = integerEnvironment(process.env.LOAD_TEST_CANDIDATES, 1200, 10, 20_000);
const jobCount = integerEnvironment(process.env.LOAD_TEST_JOBS, 24, 2, 250);

const result = spawnSync(
  "psql",
  [
    databaseUrl,
    "-v", "ON_ERROR_STOP=1",
    "-v", `org_slug=${orgSlug}`,
    "-v", `user_email=${userEmail}`,
    "-v", `candidate_count=${candidateCount}`,
    "-v", `job_count=${jobCount}`,
    "-f", resolve(root, "scripts/load-test-seed.sql"),
  ],
  { encoding: "utf8", shell: false },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error((result.stderr || result.stdout || "load-test seed failed").trim());
  process.exit(result.status ?? 1);
}
console.log(result.stdout.trim());
console.log(`✓ seeded ${candidateCount} candidate/application fixtures and ${jobCount} write fixtures`);
