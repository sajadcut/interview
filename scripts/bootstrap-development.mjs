import { spawnSync } from "node:child_process";
import { argon2, randomBytes } from "node:crypto";
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

const ARGON2_MEMORY_KIB = 65_536;
const ARGON2_PASSES = 3;
const ARGON2_PARALLELISM = 4;
const ARGON2_TAG_LENGTH = 32;

function deriveArgon2id(password, salt) {
  return new Promise((resolvePromise, reject) => {
    argon2(
      "argon2id",
      {
        message: password,
        nonce: salt,
        parallelism: ARGON2_PARALLELISM,
        tagLength: ARGON2_TAG_LENGTH,
        memory: ARGON2_MEMORY_KIB,
        passes: ARGON2_PASSES,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolvePromise(derivedKey);
      },
    );
  });
}

async function developmentPasswordHash() {
  const password = process.env.DEV_USER_PASSWORD;
  if (!password) return "";
  if (password.length < 12 || password.length > 128) {
    console.error("DEV_USER_PASSWORD must contain 12-128 characters when configured.");
    process.exit(1);
  }
  const salt = randomBytes(16);
  const derivedKey = await deriveArgon2id(password, salt);
  return [
    "argon2id",
    "v=19",
    `m=${ARGON2_MEMORY_KIB},t=${ARGON2_PASSES},p=${ARGON2_PARALLELISM}`,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

const passwordHash = await developmentPasswordHash();
const variables = {
  org_name: process.env.DEV_ORGANIZATION_NAME ?? "Local Interview Organization",
  org_slug: process.env.DEV_ORGANIZATION_SLUG ?? "local-interview",
  user_email: process.env.DEV_USER_EMAIL ?? "admin@local.interview",
  user_name: process.env.DEV_USER_DISPLAY_NAME ?? "Local Admin",
  password_hash: passwordHash,
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
if (passwordHash) console.log("✓ Development internal-user credential seeded with Argon2id");
else console.log("ℹ DEV_USER_PASSWORD is not configured; existing internal-user credential was left unchanged");

const domainReady = runPsql(
  ["-t", "-A", "-c", "select (to_regclass('public.jobs') is not null and to_regclass('public.assessments') is not null)::text;"],
  "Development domain readiness check",
);

if (domainReady === "true") {
  const seedOutput = runPsql(["-f", resolve(root, "scripts/bootstrap-domain-fixtures.sql")], "Development domain seed");
  if (seedOutput) console.log(seedOutput);
  const languageSeedOutput = runPsql(
    ["-f", resolve(root, "scripts/bootstrap-interview-language-fixtures.sql")],
    "Development interview language seed",
  );
  if (languageSeedOutput) console.log(languageSeedOutput);
  console.log("✓ M1-M5 deterministic development data seeded");
  console.log("✓ Persian interview language and spoken labels seeded");
} else {
  console.log("ℹ Domain tables are not migrated yet; M1-M5 development data seed skipped");
}
