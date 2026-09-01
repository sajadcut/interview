import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import postgres from "postgres";

const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

const configuredDatabaseUrl = process.env.DATABASE_URL;
if (!configuredDatabaseUrl) throw new Error("DATABASE_URL is required for migrations");
const databaseUrl: string = configuredDatabaseUrl;

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const migrationPattern = /^\d{4}_[a-z0-9_-]+\.sql$/i;
const migrationLockName = "interview-schema-migrations";

function checksum(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

async function migrate(): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  let migrationLockAcquired = false;
  try {
    const lockRows = await sql`
      SELECT pg_try_advisory_lock(hashtext(${migrationLockName})) AS acquired
    `;
    migrationLockAcquired = lockRows[0]?.acquired === true;
    if (!migrationLockAcquired) {
      throw new Error("Another migration process currently owns the schema migration lock");
    }

    await sql`
      CREATE TABLE IF NOT EXISTS _interview_schema_migrations (
        name varchar(255) PRIMARY KEY,
        checksum varchar(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const appliedRows = await sql`SELECT name, checksum FROM _interview_schema_migrations`;
    const applied = new Map(appliedRows.map((row) => [String(row.name), String(row.checksum)]));
    const files = (await readdir(migrationsDirectory)).filter((file) => migrationPattern.test(file)).sort();

    if (!files.length) throw new Error("No SQL migrations found");

    for (const file of files) {
      const source = await readFile(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), "utf8");
      const digest = checksum(source);
      const previous = applied.get(file);
      if (previous) {
        if (previous !== digest) {
          throw new Error(`Migration drift detected for ${file}: applied checksum differs from repository`);
        }
        console.log(`skip ${file}`);
        continue;
      }

      await sql.begin(async (transaction) => {
        await transaction.unsafe(source);
        await transaction`
          INSERT INTO _interview_schema_migrations (name, checksum)
          VALUES (${file}, ${digest})
        `;
      });
      console.log(`applied ${file}`);
    }
  } finally {
    if (migrationLockAcquired) {
      await sql`SELECT pg_advisory_unlock(hashtext(${migrationLockName}))`;
    }
    await sql.end({ timeout: 5 });
  }
}

migrate().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
