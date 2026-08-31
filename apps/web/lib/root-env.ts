import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

let loaded = false;

export function loadRootEnvironment(): void {
  if (loaded) return;

  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];

  for (const file of new Set(candidates)) {
    if (existsSync(file)) {
      loadEnvFile(file);
      loaded = true;
      return;
    }
  }
}
