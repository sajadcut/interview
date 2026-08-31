import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const migrationsDir = resolve(process.cwd(), "packages/db/migrations");
const filePattern = /^(\d{4})_[a-z0-9_-]+\.sql$/i;
const tenantReferenceable = new Set(["organizations"]);
const errors = [];

const files = (await readdir(migrationsDir)).filter((file) => filePattern.test(file)).sort();
if (!files.length) errors.push("No migrations found");

for (let index = 0; index < files.length; index += 1) {
  const file = files[index];
  const prefix = Number(file.match(filePattern)?.[1]);
  if (!Number.isInteger(prefix)) continue;
  if (index > 0) {
    const previous = Number(files[index - 1].match(filePattern)?.[1]);
    if (prefix !== previous + 1) errors.push(`Migration sequence gap: ${files[index - 1]} -> ${file}`);
  }

  const source = await readFile(resolve(migrationsDir, file), "utf8");
  const statements = source
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    const tableMatch = statement.match(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)/i);
    if (tableMatch) {
      const table = tableMatch[1];
      if (/UNIQUE\s*\(\s*organization_id\s*,\s*id\s*\)/i.test(statement)) {
        tenantReferenceable.add(table);
      }
      const foreignKeys = [...statement.matchAll(/FOREIGN\s+KEY\s*\(\s*organization_id\s*,\s*[a-z_][a-z0-9_]*\s*\)\s*REFERENCES\s+([a-z_][a-z0-9_]*)\s*\(\s*organization_id\s*,\s*id\s*\)/gi)];
      for (const match of foreignKeys) {
        const parent = match[1];
        if (!tenantReferenceable.has(parent)) {
          errors.push(`${file}: ${table} references ${parent}(organization_id,id) before that key is unique`);
        }
      }
      continue;
    }

    const uniqueIndex = statement.match(/^CREATE\s+UNIQUE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+[a-z_][a-z0-9_]*\s+ON\s+([a-z_][a-z0-9_]*)\s*\(\s*organization_id\s*,\s*id\s*\)/i);
    if (uniqueIndex) {
      tenantReferenceable.add(uniqueIndex[1]);
      continue;
    }

    const alterFk = statement.match(/FOREIGN\s+KEY\s*\(\s*organization_id\s*,\s*[a-z_][a-z0-9_]*\s*\)\s*REFERENCES\s+([a-z_][a-z0-9_]*)\s*\(\s*organization_id\s*,\s*id\s*\)/i);
    if (alterFk && !tenantReferenceable.has(alterFk[1])) {
      errors.push(`${file}: ALTER TABLE references ${alterFk[1]}(organization_id,id) before that key is unique`);
    }
  }
}

if (errors.length) {
  console.error("Migration contract validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`✓ ${files.length} migrations satisfy sequencing and tenant composite-FK contracts`);
