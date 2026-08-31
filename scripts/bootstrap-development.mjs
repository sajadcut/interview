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

const args = [databaseUrl, "-v", "ON_ERROR_STOP=1"];
for (const [key, value] of Object.entries(variables)) args.push("-v", `${key}=${value}`);
args.push("-f", resolve(root, "scripts/bootstrap-development.sql"));

const result = spawnSync("psql", args, {
  encoding: "utf8",
  shell: process.platform === "win32",
  stdio: ["inherit", "pipe", "pipe"],
});

if (result.status !== 0) {
  console.error((result.stderr || result.stdout || "Development bootstrap failed").trim());
  process.exit(result.status ?? 1);
}

console.log(result.stdout.trim());
