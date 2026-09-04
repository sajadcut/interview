import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const contractPath = resolve(root, "contracts/whisper-stt.v1.json");
const envPath = resolve(root, ".env.example");
const clientPath = resolve(root, "apps/api/src/interviews/whisper-http.client.ts");
const workerContractPath = resolve(root, "services/media-worker/whisper_contract.py");
const workerPath = resolve(root, "services/media-worker/server.py");

function invariant(condition, message) {
  if (!condition) throw new Error(`Whisper contract check failed: ${message}`);
}

const [contractText, envExample, clientSource, workerContractSource, workerSource] = await Promise.all([
  readFile(contractPath, "utf8"),
  readFile(envPath, "utf8"),
  readFile(clientPath, "utf8"),
  readFile(workerContractPath, "utf8"),
  readFile(workerPath, "utf8"),
]);
const contract = JSON.parse(contractText);

invariant(contract.version === "whisper-stt.v1", "version must be whisper-stt.v1");
invariant(contract.provider === "whisper.cpp", "provider must be whisper.cpp");
invariant(contract.basePath === "/stt", "basePath must be /stt");
invariant(contract.health?.method === "GET" && contract.health?.path === "/health", "health endpoint drift");
invariant(contract.finalize?.method === "POST" && contract.finalize?.path === "/finalize", "finalize endpoint drift");
invariant(contract.finalize?.request?.maxBytes === 20 * 1024 * 1024, "audio byte limit drift");

const contentTypes = new Set(contract.finalize?.request?.contentTypes ?? []);
invariant(contentTypes.has("audio/wav") && contentTypes.has("audio/x-wav"), "WAV content types are required");
const requiredHeaders = new Set(contract.finalize?.request?.requiredHeaders ?? []);
for (const header of ["x-media-worker-secret", "x-stt-contract-version", "x-request-id"]) {
  invariant(requiredHeaders.has(header), `missing required header ${header}`);
}

const expectedErrors = new Map([
  ["invalid_request", [400, false]],
  ["unauthorized", [401, false]],
  ["forbidden", [403, false]],
  ["contract_mismatch", [409, false]],
  ["payload_too_large", [413, false]],
  ["unsupported_media_type", [415, false]],
  ["invalid_audio", [422, false]],
  ["rate_limited", [429, true]],
  ["worker_error", [500, true]],
  ["provider_error", [502, true]],
  ["provider_unavailable", [503, true]],
  ["provider_timeout", [504, true]],
]);
const actualErrors = new Map(
  (contract.errors ?? []).map((entry) => [entry.code, [entry.status, entry.retryable]]),
);
for (const [code, expected] of expectedErrors) {
  invariant(JSON.stringify(actualErrors.get(code)) === JSON.stringify(expected), `error mapping drift for ${code}`);
}

invariant(
  JSON.stringify(contract.retry?.retryableStatuses) === JSON.stringify([429, 500, 502, 503, 504]),
  "retryable status list drift",
);
invariant(contract.retry?.maxAttempts?.min === 1 && contract.retry?.maxAttempts?.max === 5, "attempt bounds drift");
invariant(contract.retry?.maximumDelayMs === 5000, "retry delay cap drift");

for (const variable of [
  "STT_PROVIDER=disabled",
  "STT_BASE_URL=http://127.0.0.1:9010/stt",
  "STT_REQUEST_TIMEOUT_MS=130000",
  "STT_MAX_ATTEMPTS=3",
  "STT_RETRY_BASE_MS=250",
  "WHISPER_TIMEOUT_SECONDS=120",
]) {
  invariant(envExample.includes(variable), `.env.example is missing ${variable}`);
}

for (const source of [clientSource, workerContractSource]) {
  invariant(source.includes('whisper-stt.v1'), "implementation contract version drift");
  invariant(source.includes("20 * 1024 * 1024"), "implementation audio limit drift");
}
for (const marker of [
  "x-stt-contract-version",
  "x-request-id",
  "provider_unavailable",
  "provider_timeout",
  "unsupported_media_type",
  "invalid_audio",
]) {
  invariant(workerSource.includes(marker), `media-worker is missing contract marker ${marker}`);
  invariant(clientSource.includes(marker), `API Whisper client is missing contract marker ${marker}`);
}

console.log("Whisper STT contract v1 is internally consistent.");
