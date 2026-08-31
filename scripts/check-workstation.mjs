import { spawnSync } from "node:child_process";

const commands = [
  ["node", ["--version"], "Node.js 24"],
  ["pnpm", ["--version"], "pnpm 11"],
  ["git", ["--version"], "Git"],
  ["psql", ["--version"], "PostgreSQL client"],
];

let failed = false;

for (const [command, args, label] of commands) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: process.platform === "win32" });
  if (result.status === 0) {
    console.log(`✓ ${label}: ${(result.stdout || result.stderr).trim()}`);
  } else {
    failed = true;
    console.error(`✗ ${label}: command '${command}' was not available`);
  }
}

if (failed) {
  console.error("\nWorkstation prerequisites are incomplete. See docs/local-development.md.");
  process.exitCode = 1;
} else {
  console.log("\nWorkstation prerequisites detected.");
}
