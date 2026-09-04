import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const envExample = readFileSync(resolve(root, ".env.example"), "utf8");
const serverTemplate = readFileSync(resolve(root, "ops/livekit/livekit.yaml.example"), "utf8");
const runbook = readFileSync(resolve(root, "docs/operations/livekit-deployment.md"), "utf8");

const requiredEnv = [
  "MEDIA_REALTIME_ENABLED",
  "MEDIA_TRANSPORT_PROVIDER",
  "MEDIA_PROVIDER_TIMEOUT_MS",
  "LIVEKIT_URL",
  "LIVEKIT_HEALTH_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "LIVEKIT_TOKEN_TTL_SECONDS",
  "TURN_URLS",
];

for (const name of requiredEnv) {
  if (!new RegExp(`^${name}=`, "m").test(envExample)) {
    throw new Error(`.env.example is missing ${name}`);
  }
}

if (!/^MEDIA_REALTIME_ENABLED=false$/m.test(envExample)) {
  throw new Error("LiveKit contract requires MEDIA_REALTIME_ENABLED=false in .env.example");
}
if (!/^MEDIA_TRANSPORT_PROVIDER=disabled$/m.test(envExample)) {
  throw new Error("LiveKit contract requires MEDIA_TRANSPORT_PROVIDER=disabled in .env.example");
}
const secretLine = envExample.match(/^LIVEKIT_API_SECRET=(.*)$/m)?.[1] ?? "missing";
if (secretLine !== "") {
  throw new Error("LIVEKIT_API_SECRET must remain empty in .env.example");
}

const requiredTemplateFragments = [
  "port: 7880",
  "tcp_port: 7881",
  "port_range_start: 50000",
  "port_range_end: 60000",
  "prometheus_port: 6789",
  "enabled: true",
  "tls_port: 5349",
  "udp_port: 3478",
  "REPLACE_WITH_LIVEKIT_API_KEY: REPLACE_WITH_LIVEKIT_API_SECRET",
];
for (const fragment of requiredTemplateFragments) {
  if (!serverTemplate.includes(fragment)) {
    throw new Error(`LiveKit server template is missing: ${fragment}`);
  }
}

const requiredRunbookFragments = [
  "GET /health/livekit",
  "MEDIA_TRANSPORT_PROVIDER=livekit",
  "MEDIA_REALTIME_ENABLED=false",
  "wss://",
  "https://",
  "100+ interview benchmark",
];
for (const fragment of requiredRunbookFragments) {
  if (!runbook.includes(fragment)) {
    throw new Error(`LiveKit deployment runbook is missing: ${fragment}`);
  }
}

console.log("✓ LiveKit deployment config, env and health contracts are present and safe by default");
