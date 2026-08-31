import { spawnSync } from "node:child_process";

const requiredNode = { major: 22, minor: 14 };
const nodeMatch = process.versions.node.match(/^(\d+)\.(\d+)\.(\d+)/);
let failed = false;

if (!nodeMatch) {
  failed = true;
  console.error(`✗ Node.js: unable to parse ${process.version}`);
} else {
  const [, majorText, minorText] = nodeMatch;
  const major = Number(majorText);
  const minor = Number(minorText);
  const supported = major === requiredNode.major && minor >= requiredNode.minor;
  if (supported) {
    console.log(`✓ Node.js 22.14+: ${process.version}`);
  } else {
    failed = true;
    console.error(`✗ Node.js: ${process.version}; required >=22.14.0 <23`);
  }
}

const commands = [
  ["pnpm", ["--version"], "pnpm 11", (value) => value.startsWith("11.")],
  ["git", ["--version"], "Git", () => true],
  ["psql", ["--version"], "PostgreSQL client", () => true],
];

for (const [command, args, label, validate] of commands) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const output = (result.stdout || result.stderr || "").trim();
  if (result.status === 0 && validate(output)) {
    console.log(`✓ ${label}: ${output}`);
  } else {
    failed = true;
    console.error(
      result.status === 0
        ? `✗ ${label}: unsupported version '${output}'`
        : `✗ ${label}: command '${command}' was not available`,
    );
  }
}

if (failed) {
  console.error("\nWorkstation prerequisites are incomplete. See docs/local-development.md.");
  process.exitCode = 1;
} else {
  console.log("\nWorkstation prerequisites detected.");
}
