import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const nodeModules = resolve(root, "node_modules");
const lockfile = resolve(root, "package-lock.json");

const workspaceCheck = spawnSync(process.execPath, [resolve(root, "scripts/check-workspaces.mjs")], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});
if (workspaceCheck.status !== 0) process.exit(workspaceCheck.status ?? 1);

if (existsSync(nodeModules)) {
  console.log("Removing node_modules from the previous dependency graph...");
  rmSync(nodeModules, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}

if (existsSync(lockfile)) {
  console.log("Removing stale package-lock.json...");
  rmSync(lockfile, { force: true });
}

const npmExecPath = process.env.npm_execpath;
let installResult;

if (npmExecPath) {
  installResult = spawnSync(process.execPath, [npmExecPath, "install"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
} else if (process.platform === "win32") {
  installResult = spawnSync("cmd.exe", ["/d", "/s", "/c", "npm install"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
} else {
  installResult = spawnSync("npm", ["install"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

if (installResult.error) {
  console.error(installResult.error.message);
  process.exit(1);
}
process.exit(installResult.status ?? 1);
