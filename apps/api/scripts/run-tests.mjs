import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));

async function collectSpecs(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSpecs(path)));
    } else if (entry.isFile() && entry.name.endsWith(".spec.ts")) {
      files.push(path);
    }
  }
  return files;
}

const specs = (await collectSpecs(sourceRoot)).sort();
if (!specs.length) {
  throw new Error("No API test specifications were discovered under src/");
}

console.log(`Discovered ${specs.length} API test specification files.`);

const child = spawn(process.execPath, ["--import", "tsx", "--test", ...specs], {
  stdio: "inherit",
  env: process.env,
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) {
      reject(new Error(`API test runner terminated by signal ${signal}`));
      return;
    }
    resolve(code ?? 1);
  });
});

process.exitCode = exitCode;
