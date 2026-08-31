import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const workspaceRoots = ["apps", "packages"];
const lockfile = resolve(root, "package-lock.json");

const workspaceCheck = spawnSync(process.execPath, [resolve(root, "scripts/check-workspaces.mjs")], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});
if (workspaceCheck.status !== 0) process.exit(workspaceCheck.status ?? 1);

const nodeModulesDirectories = [resolve(root, "node_modules")];
for (const workspaceRoot of workspaceRoots) {
  const absoluteRoot = resolve(root, workspaceRoot);
  if (!existsSync(absoluteRoot)) continue;

  for (const entry of readdirSync(absoluteRoot)) {
    const workspaceDirectory = join(absoluteRoot, entry);
    if (!statSync(workspaceDirectory).isDirectory()) continue;
    nodeModulesDirectories.push(join(workspaceDirectory, "node_modules"));
  }
}

for (const directory of nodeModulesDirectories) {
  if (!existsSync(directory)) continue;
  console.log(`Removing stale dependency tree: ${directory}`);
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
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
