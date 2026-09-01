import { spawnSync } from "node:child_process";

const expectedRegistry = "https://nexus3.dotin.ir/repository/Dotin-NPM/";
const blockerSpec = "livekit-client@2.21.0";

function runNpm(args, options = {}) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return spawnSync(process.execPath, [npmExecPath, ...args], {
      encoding: "utf8",
      ...options,
    });
  }

  return spawnSync("npm", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    ...options,
  });
}

const configResult = runNpm(["config", "get", "registry"]);
if (configResult.status !== 0) {
  console.error("Unable to read npm registry configuration.");
  console.error((configResult.stderr || configResult.stdout || "").trim());
  if (configResult.error) console.error(configResult.error.message);
  process.exit(1);
}

const configuredRegistry = configResult.stdout.trim();
if (configuredRegistry !== expectedRegistry) {
  console.error(`Registry mismatch. Expected ${expectedRegistry} but npm resolved ${configuredRegistry || "<empty>"}.`);
  console.error("Run this command from the repository root so the committed .npmrc is applied.");
  process.exit(1);
}
console.log(`✓ mandatory npm registry: ${configuredRegistry}`);

const probeResult = runNpm(
  ["view", blockerSpec, "version", "--registry", expectedRegistry, "--fetch-timeout", "30000", "--fetch-retries", "1"],
  { timeout: 45_000 },
);
if (probeResult.status !== 0) {
  console.error(`✗ Dotin Nexus cannot currently serve required package ${blockerSpec}.`);
  console.error((probeResult.stderr || probeResult.stdout || "").trim());
  if (probeResult.error) console.error(probeResult.error.message);
  console.error(
    "The private registry is mandatory. Repair/proxy/cache livekit-client in Dotin-NPM; do not bypass Nexus.",
  );
  process.exit(probeResult.status ?? 1);
}
console.log(`✓ Dotin Nexus blocker probe: ${blockerSpec} -> ${probeResult.stdout.trim()}`);
