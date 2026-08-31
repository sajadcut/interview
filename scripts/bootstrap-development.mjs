import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

const root = process.cwd();
const envFile = resolve(root, ".env");
if (existsSync(envFile)) loadEnvFile(envFile);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required. Copy .env.example to .env first.");
  process.exit(1);
}

const variables = {
  org_name: process.env.DEV_ORGANIZATION_NAME ?? "Local Interview Organization",
  org_slug: process.env.DEV_ORGANIZATION_SLUG ?? "local-interview",
  user_email: process.env.DEV_USER_EMAIL ?? "admin@local.interview",
  user_name: process.env.DEV_USER_DISPLAY_NAME ?? "Local Admin",
};

function runPsql(extraArgs, label) {
  const args = [databaseUrl, "-v", "ON_ERROR_STOP=1"];
  for (const [key, value] of Object.entries(variables)) args.push("-v", `${key}=${value}`);
  args.push(...extraArgs);

  const result = spawnSync("psql", args, {
    encoding: "utf8",
    shell: false,
    stdio: ["inherit", "pipe", "pipe"],
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error((result.stderr || result.stdout || `${label} failed`).trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

const identityOutput = runPsql(["-f", resolve(root, "scripts/bootstrap-development.sql")], "Development identity bootstrap");
console.log(identityOutput);

const domainReady = runPsql(
  ["-t", "-A", "-c", "select (to_regclass('public.jobs') is not null and to_regclass('public.assessments') is not null)::text;"],
  "Development domain readiness check",
);

if (domainReady === "true") {
  const seedOutput = runPsql(["-f", resolve(root, "scripts/bootstrap-development-data.sql")], "Development domain seed");
  if (seedOutput) console.log(seedOutput);
  console.log("✓ M1-M5 deterministic development data seeded");
} else {
  console.log("ℹ Domain tables are not migrated yet; M1-M5 development data seed skipped");
}
