import { spawnSync } from "node:child_process";

const expectedRegistry = "https://nexus3.dotin.ir/repository/Dotin-NPM/";

const configResult = spawnSync("pnpm", ["config", "get", "registry"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (configResult.status !== 0) {
  console.error("Unable to read pnpm registry configuration.");
  console.error((configResult.stderr || configResult.stdout || "").trim());
  process.exit(1);
}

const configuredRegistry = configResult.stdout.trim();
if (configuredRegistry !== expectedRegistry) {
  console.error(`Registry mismatch. Expected ${expectedRegistry} but pnpm resolved ${configuredRegistry || "<empty>"}.`);
  console.error("Run this command from the repository root so the committed .npmrc is applied.");
  process.exit(1);
}

console.log(`✓ pnpm registry: ${configuredRegistry}`);

const probeResult = spawnSync(
  "pnpm",
  ["view", "@eslint/js", "version", "--registry", expectedRegistry],
  {
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 120_000,
  },
);

if (probeResult.status !== 0) {
  console.error("✗ Dotin Nexus is configured but the package probe failed.");
  console.error((probeResult.stderr || probeResult.stdout || "").trim());
  process.exit(probeResult.status ?? 1);
}

console.log(`✓ Dotin Nexus package probe: @eslint/js ${probeResult.stdout.trim()}`);
