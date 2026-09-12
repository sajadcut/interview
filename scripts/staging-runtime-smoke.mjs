import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildEvidence as buildPreflightEvidence,
  loadStagingEnvironment,
  passed,
  probeStagingRuntime,
  validateStagingEnvironment,
} from "./staging-runtime-preflight.mjs";

const root = process.cwd();
const whisperContract = JSON.parse(readFileSync(resolve(root, "contracts/whisper-stt.v1.json"), "utf8"));
const ttsContract = JSON.parse(readFileSync(resolve(root, "contracts/tts-synthesis.v1.json"), "utf8"));
const vadContract = JSON.parse(readFileSync(resolve(root, "contracts/silero-vad.v1.json"), "utf8"));

function result(id, status, detail, measurements = {}) {
  return { id, status, detail, measurements };
}

function pass(id, detail, measurements) {
  return result(id, "pass", detail, measurements);
}

function fail(id, detail, measurements) {
  return result(id, "fail", detail, measurements);
}

function safeUrl(baseUrl, path) {
  const base = String(baseUrl ?? "").trim();
  if (!base) throw new Error("base URL is not configured");
  return new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`).toString();
}

async function jsonBody(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error("expected application/json response");
  return response.json();
}

function isPcmWav(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 44) return false;
  const prefix = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 12));
  return prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WAVE";
}

async function timed(operation) {
  const started = performance.now();
  const value = await operation();
  return { value, durationMs: Math.round((performance.now() - started) * 100) / 100 };
}

export async function runCandidateInterviewerSmoke(env, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const target = safeUrl(env.STAGING_API_BASE_URL, "/v1/candidate-interview/health");
  try {
    const { value: response, durationMs } = await timed(() =>
      fetchImpl(target, {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      }),
    );
    if (!response.ok) return fail("smoke.interviewer", `candidate interviewer health returned HTTP ${response.status}`, { durationMs });
    const body = await jsonBody(response);
    if (body?.ready !== true || body?.activeMode !== "llm" || body?.interviewer?.ready !== true) {
      return fail("smoke.interviewer", "candidate interviewer is not using a ready real LLM path", { durationMs });
    }
    return pass("smoke.interviewer", "candidate interviewer reports activeMode=llm with a ready provider", { durationMs });
  } catch (error) {
    return fail("smoke.interviewer", error instanceof Error ? error.message : "candidate interviewer probe failed");
  }
}

export async function synthesizeSmokeAudio(env, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 70_000;
  const spokenText = options.spokenText ?? env.STAGING_SMOKE_TEXT ?? "این یک تست فنی Kubernetes و Redis برای مسیر صوتی مصاحبه است.";
  const requestId = `staging-smoke-tts-${randomUUID()}`;
  const target = safeUrl(env.TTS_BASE_URL, ttsContract.request.path);
  const sharedSecret = String(env.TTS_SHARED_SECRET || env.MEDIA_WORKER_SHARED_SECRET || "");
  const { value: response, durationMs } = await timed(() =>
    fetchImpl(target, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "content-type": "application/json",
        "x-tts-contract-version": ttsContract.version,
        "x-request-id": requestId,
        "x-tts-secret": sharedSecret,
      },
      body: JSON.stringify({ spokenText }),
    }),
  );
  if (!response.ok) throw new Error(`TTS smoke request returned HTTP ${response.status}`);
  if ((response.headers.get("content-type") ?? "").split(";", 1)[0].trim() !== "audio/wav") {
    throw new Error("TTS smoke response is not audio/wav");
  }
  if (response.headers.get("x-tts-contract-version") !== ttsContract.version) {
    throw new Error("TTS smoke response contract version mismatch");
  }
  const audio = new Uint8Array(await response.arrayBuffer());
  if (!isPcmWav(audio)) throw new Error("TTS smoke response is not a valid WAV container");
  return { audio, durationMs, audioBytes: audio.byteLength };
}

export async function runVadSmoke(env, audio, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const requestId = `staging-smoke-vad-${randomUUID()}`;
  const target = safeUrl(env.VAD_BASE_URL, vadContract.request.path);
  try {
    const { value: response, durationMs } = await timed(() =>
      fetchImpl(target, {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "content-type": "audio/wav",
          "x-vad-contract-version": vadContract.version,
          "x-request-id": requestId,
          "x-vad-secret": String(env.MEDIA_WORKER_SHARED_SECRET ?? ""),
        },
        body: audio,
      }),
    );
    if (!response.ok) return fail("smoke.vad", `VAD smoke request returned HTTP ${response.status}`, { durationMs });
    const body = await jsonBody(response);
    const segments = Array.isArray(body?.segments) ? body.segments : [];
    if (body?.contractVersion !== vadContract.version || body?.speechDetected !== true || segments.length === 0) {
      return fail("smoke.vad", "VAD did not detect speech in TTS-generated smoke audio", { durationMs, segments: segments.length });
    }
    return pass("smoke.vad", "VAD detected speech in TTS-generated audio", { durationMs, segments: segments.length });
  } catch (error) {
    return fail("smoke.vad", error instanceof Error ? error.message : "VAD smoke request failed");
  }
}

export async function runSttSmoke(env, audio, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? Math.max(Number(env.STT_REQUEST_TIMEOUT_MS || 130_000), 5_000);
  const requestId = `staging-smoke-stt-${randomUUID()}`;
  const target = safeUrl(env.STT_BASE_URL, whisperContract.finalize.path.replace(/^\/stt\//, "/"));
  try {
    const { value: response, durationMs } = await timed(() =>
      fetchImpl(target, {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "content-type": "audio/wav",
          "x-media-worker-secret": String(env.MEDIA_WORKER_SHARED_SECRET ?? ""),
          "x-stt-contract-version": whisperContract.version,
          "x-request-id": requestId,
        },
        body: audio,
      }),
    );
    if (!response.ok) return fail("smoke.stt", `Whisper smoke request returned HTTP ${response.status}`, { durationMs });
    const body = await jsonBody(response);
    const transcript = typeof body?.text === "string" ? body.text.trim() : "";
    if (body?.contractVersion !== whisperContract.version || body?.isFinal !== true || !transcript) {
      return fail("smoke.stt", "Whisper smoke response did not contain a finalized non-empty transcript", {
        durationMs,
        transcriptChars: transcript.length,
      });
    }
    return pass("smoke.stt", "Whisper finalized a non-empty transcript from TTS-generated audio", {
      durationMs,
      transcriptChars: transcript.length,
      language: typeof body.language === "string" ? body.language : "unknown",
      provider: typeof body.provider === "string" ? body.provider : "unknown",
    });
  } catch (error) {
    return fail("smoke.stt", error instanceof Error ? error.message : "Whisper smoke request failed");
  }
}

export async function runSpeechRoundTripSmoke(env, options = {}) {
  try {
    const synthesized = await synthesizeSmokeAudio(env, options);
    const ttsResult = pass("smoke.tts", "TTS produced a valid WAV for the synthetic smoke phrase", {
      durationMs: synthesized.durationMs,
      audioBytes: synthesized.audioBytes,
    });
    const vadResult = await runVadSmoke(env, synthesized.audio, options);
    const sttResult = await runSttSmoke(env, synthesized.audio, options);
    return [ttsResult, vadResult, sttResult];
  } catch (error) {
    return [fail("smoke.tts", error instanceof Error ? error.message : "TTS smoke request failed")];
  }
}

export function buildSmokeEvidence({ envFile, preflight, smokeChecks }) {
  return {
    schemaVersion: "staging-runtime-smoke.v1",
    generatedAt: new Date().toISOString(),
    environmentFile: envFile,
    result: passed(smokeChecks) && preflight.result === "pass" ? "pass" : "fail",
    preflight: {
      schemaVersion: preflight.schemaVersion,
      result: preflight.result,
      configurationCheckCount: preflight.configurationChecks.length,
      runtimeCheckCount: preflight.runtimeChecks.length,
    },
    smokeChecks,
    privacy: {
      syntheticAudioPersisted: false,
      transcriptTextPersisted: false,
      secretsPersisted: false,
    },
  };
}

function parseArguments(argv) {
  const options = {
    envFile: process.env.STAGING_ENV_FILE?.trim() || ".env.staging.local",
    evidenceFile: process.env.STAGING_SMOKE_EVIDENCE_FILE?.trim() || ".local-data/evidence/staging-runtime-smoke.json",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--env") options.envFile = argv[++index];
    else if (argument === "--evidence") options.evidenceFile = argv[++index];
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printChecks(title, checks) {
  console.log(`\n${title}`);
  for (const check of checks) {
    console.log(`${check.status === "pass" ? "PASS" : "FAIL"}  ${check.id.padEnd(24)} ${check.detail}`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/staging-runtime-smoke.mjs [--env .env.staging.local] [--evidence path]");
    return;
  }
  const envPath = resolve(root, options.envFile);
  if (!existsSync(envPath)) {
    console.error(`Staging environment file not found: ${envPath}`);
    process.exitCode = 1;
    return;
  }
  const env = loadStagingEnvironment(envPath);
  const configurationChecks = validateStagingEnvironment(env);
  const runtimeChecks = passed(configurationChecks) ? await probeStagingRuntime(env) : [];
  const preflight = buildPreflightEvidence({
    envFile: options.envFile,
    configurationChecks,
    runtimeChecks,
  });
  const smokeChecks = [];
  if (preflight.result === "pass") {
    smokeChecks.push(await runCandidateInterviewerSmoke(env));
    smokeChecks.push(...(await runSpeechRoundTripSmoke(env)));
  }
  const evidence = buildSmokeEvidence({ envFile: options.envFile, preflight, smokeChecks });
  printChecks("Preflight configuration", configurationChecks);
  printChecks("Preflight runtime", runtimeChecks);
  printChecks("End-to-end smoke", smokeChecks);
  const evidencePath = resolve(root, options.evidenceFile);
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`\nEvidence written to ${options.evidenceFile}`);
  if (evidence.result !== "pass") process.exitCode = 1;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) await main();
