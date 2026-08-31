import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const workspaceRoots = ["apps", "packages"];
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const manifests = [];

for (const workspaceRoot of workspaceRoots) {
  const absoluteRoot = resolve(root, workspaceRoot);
  for (const entry of readdirSync(absoluteRoot)) {
    const directory = join(absoluteRoot, entry);
    if (!statSync(directory).isDirectory()) continue;
    const manifestPath = join(directory, "package.json");
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifests.push({ manifestPath, manifest });
    } catch (error) {
      console.error(`✗ Invalid or missing workspace manifest: ${manifestPath}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }
}

const byName = new Map();
let failed = false;

for (const { manifestPath, manifest } of manifests) {
  const name = manifest?.name;
  const version = manifest?.version;

  if (typeof name !== "string" || !name.startsWith("@interview/")) {
    failed = true;
    console.error(`✗ ${manifestPath}: workspace name must start with @interview/`);
  }

  if (typeof version !== "string" || !semverPattern.test(version)) {
    failed = true;
    console.error(`✗ ${manifestPath}: invalid semantic version '${String(version)}'`);
  }

  if (typeof name === "string") {
    if (byName.has(name)) {
      failed = true;
      console.error(`✗ Duplicate workspace name: ${name}`);
    }
    byName.set(name, version);
  }
}

const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
for (const { manifestPath, manifest } of manifests) {
  for (const field of dependencyFields) {
    const dependencies = manifest?.[field];
    if (!dependencies || typeof dependencies !== "object") continue;

    for (const [name, requested] of Object.entries(dependencies)) {
      if (!name.startsWith("@interview/")) continue;
      const actual = byName.get(name);
      if (!actual) {
        failed = true;
        console.error(`✗ ${manifestPath}: internal dependency ${name} is not a declared workspace`);
        continue;
      }
      if (requested !== actual) {
        failed = true;
        console.error(
          `✗ ${manifestPath}: internal dependency ${name} must use exact workspace version ${actual}, got ${requested}`,
        );
      }
    }
  }
}

if (failed) process.exit(1);

console.log(`✓ ${manifests.length} npm workspace manifests have valid names and semantic versions.`);
console.log("✓ Internal @interview/* dependencies match exact local workspace versions.");
