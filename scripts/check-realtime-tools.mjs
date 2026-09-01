import { spawnSync } from "node:child_process";

const checks = [
  { key: "livekit", label: "LiveKit server", command: "livekit-server", args: ["--version"], required: true },
  { key: "python", label: "Python", command: process.platform === "win32" ? "python" : "python3", args: ["--version"], required: true },
  { key: "ffmpeg", label: "FFmpeg", command: "ffmpeg", args: ["-version"], required: true },
  { key: "whisper", label: "whisper.cpp CLI", command: process.env.WHISPER_CLI?.trim() || "whisper-cli", args: ["--help"], required: true },
  { key: "turn", label: "coturn", command: "turnserver", args: ["--version"], required: false },
];

function checkCommand(check) {
  const result = spawnSync(check.command, check.args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().split(/\r?\n/)[0] ?? "";
  return {
    ...check,
    available: !result.error && result.status === 0,
    detail: result.error?.code === "ENOENT" ? "not found on PATH" : output || `exit ${result.status ?? "unknown"}`,
  };
}

async function checkHttp(name, url) {
  if (!url) return { name, configured: false, reachable: false, detail: "URL not configured" };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000), cache: "no-store" });
    return {
      name,
      configured: true,
      reachable: response.ok,
      detail: `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name,
      configured: true,
      reachable: false,
      detail: error instanceof Error ? error.message : "probe failed",
    };
  }
}

const commandResults = checks.map(checkCommand);
const livekitHealthBase = process.env.LIVEKIT_HEALTH_URL?.trim();
const mediaWorkerBase = process.env.MEDIA_WORKER_BASE_URL?.trim();
const httpResults = await Promise.all([
  checkHttp("LiveKit HTTP", livekitHealthBase ? `${livekitHealthBase.replace(/\/$/, "")}/` : ""),
  checkHttp("Media worker", mediaWorkerBase ? `${mediaWorkerBase.replace(/\/$/, "")}/health` : ""),
]);

console.log("Realtime workstation readiness\n");
for (const result of commandResults) {
  const state = result.available ? "OK" : result.required ? "MISSING" : "OPTIONAL";
  console.log(`${state.padEnd(8)} ${result.label.padEnd(20)} ${result.detail}`);
}
for (const result of httpResults) {
  const state = !result.configured ? "CONFIG" : result.reachable ? "OK" : "DOWN";
  console.log(`${state.padEnd(8)} ${result.name.padEnd(20)} ${result.detail}`);
}

const missingRequired = commandResults.filter((result) => result.required && !result.available);
if (missingRequired.length) {
  console.error(`\nMissing required realtime tools: ${missingRequired.map((item) => item.label).join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("\nCore local realtime executables are present. Provider health is validated separately when services are started.");
}
