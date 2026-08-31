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

function runNpm(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return spawnSync(process.execPath, [npmExecPath, ...args], {
      encoding: "utf8",
    });
  }

  return spawnSync("npm", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
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

const npmResult = runNpm(["--version"]);
const npmOutput = (npmResult.stdout || npmResult.stderr || "").trim();
const npmVersion = parseVersion(npmOutput);
if (npmResult.status === 0 && npmVersion?.major === 11 && atLeast(npmVersion, requiredNpm)) {
  console.log(`✓ npm 11.6.2+: ${npmOutput}`);
} else {
  failed = true;
  console.error(
    npmResult.status === 0
      ? `✗ npm: unsupported version '${npmOutput}'`
      : `✗ npm: command was not available${npmResult.error ? ` (${npmResult.error.message})` : ""}`,
  );
}

const gitResult = spawnSync("git", ["--version"], {
  encoding: "utf8",
  shell: false,
});
const gitOutput = (gitResult.stdout || gitResult.stderr || "").trim();
if (gitResult.status === 0) {
  console.log(`✓ Git: ${gitOutput}`);
} else {
  failed = true;
  console.error("✗ Git: command 'git' was not available");
}

if (failed) {
  console.error("\nJavaScript workstation prerequisites are incomplete. See docs/local-development.md.");
  process.exitCode = 1;
} else {
  console.log("\nJavaScript workstation prerequisites detected.");
  console.log("PostgreSQL is validated separately with `npm run db:check` when database work begins.");
}
