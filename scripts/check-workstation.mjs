import { spawnSync } from "node:child_process";

const requiredNode = { major: 25, minor: 9, patch: 0 };
const requiredNpm = { major: 11, minor: 6, patch: 2 };

function parseVersion(value) {
  const match = String(value).trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function atLeast(version, minimum) {
  if (version.major !== minimum.major) return version.major > minimum.major;
  if (version.minor !== minimum.minor) return version.minor > minimum.minor;
  return version.patch >= minimum.patch;
}

let failed = false;
const nodeVersion = parseVersion(process.versions.node);
const nodeSupported = nodeVersion?.major === 25 && atLeast(nodeVersion, requiredNode);

if (nodeSupported) {
  console.log(`✓ Node.js 25.9+: ${process.version}`);
} else {
  failed = true;
  console.error(`✗ Node.js: ${process.version}; required >=25.9.0 <26`);
}

const commands = [
  [process.platform === "win32" ? "npm.cmd" : "npm", ["--version"], "npm 11.6.2+", (value) => {
    const version = parseVersion(value);
    return Boolean(version && version.major === 11 && atLeast(version, requiredNpm));
  }],
  ["git", ["--version"], "Git", () => true],
  ["psql", ["--version"], "PostgreSQL client", () => true],
];

for (const [command, args, label, validate] of commands) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
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
