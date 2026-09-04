import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_TEST_CASES = 100;
const MAX_IO_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_EXECUTION_TIMEOUT_MS = 5000;
const MAX_EXECUTION_TIMEOUT_MS = 30000;

const LANGUAGE_DEFINITIONS = {
  javascript: {
    aliases: new Set(["javascript", "js", "node", "nodejs"]),
    filename: "main.mjs",
    imageEnvironmentKey: "ASSESSMENT_NODE_IMAGE",
    defaultImage: "node:24-alpine",
    command: ["node", "/workspace/main.mjs"],
  },
  python: {
    aliases: new Set(["python", "python3", "py"]),
    filename: "main.py",
    imageEnvironmentKey: "ASSESSMENT_PYTHON_IMAGE",
    defaultImage: "python:3.13-alpine",
    command: ["python3", "-I", "-B", "/workspace/main.py"],
  },
};

function boundedInteger(value, fallback, min, max) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trimEnd();
}

export function resolveLanguage(language, env = process.env) {
  const normalized = String(language ?? "").trim().toLowerCase();
  for (const [key, definition] of Object.entries(LANGUAGE_DEFINITIONS)) {
    if (definition.aliases.has(normalized)) {
      return {
        key,
        filename: definition.filename,
        image: String(env[definition.imageEnvironmentKey] || definition.defaultImage).trim(),
        command: [...definition.command],
      };
    }
  }
  throw new Error(`Unsupported assessment language: ${language}`);
}

export function parseRunnerPolicy(policy) {
  const value = policy && typeof policy === "object" && !Array.isArray(policy) ? policy : {};
  const rawCases = Array.isArray(value.testCases) ? value.testCases : [];
  if (rawCases.length < 1) throw new Error("runnerPolicy.testCases must contain at least one test case");
  if (rawCases.length > MAX_TEST_CASES) throw new Error(`runnerPolicy.testCases exceeds ${MAX_TEST_CASES} cases`);

  const testCases = rawCases.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`runnerPolicy.testCases[${index}] must be an object`);
    }
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 160) : `case-${index + 1}`;
    const stdin = typeof item.stdin === "string" ? item.stdin : "";
    const expectedStdout = typeof item.expectedStdout === "string" ? item.expectedStdout : "";
    if (Buffer.byteLength(stdin, "utf8") > MAX_IO_BYTES) throw new Error(`Test case ${name} stdin is too large`);
    if (Buffer.byteLength(expectedStdout, "utf8") > MAX_IO_BYTES) throw new Error(`Test case ${name} expectedStdout is too large`);
    return { name, stdin, expectedStdout };
  });

  return {
    testCases,
    executionTimeoutMs: boundedInteger(
      Number(value.executionTimeoutMs),
      DEFAULT_EXECUTION_TIMEOUT_MS,
      250,
      MAX_EXECUTION_TIMEOUT_MS,
    ),
    cpuLimit: Math.max(0.1, Math.min(2, Number(value.cpuLimit) || 1)),
    pidsLimit: boundedInteger(Number(value.pidsLimit), 64, 16, 256),
  };
}

export function buildContainerRunArgs({
  containerName,
  workspace,
  image,
  command,
  memoryLimitMb,
  cpuLimit,
  pidsLimit,
}) {
  const memory = boundedInteger(Number(memoryLimitMb), 256, 64, 4096);
  return [
    "run",
    "--rm",
    "--name",
    containerName,
    "--pull",
    "never",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges=true",
    "--pids-limit",
    String(pidsLimit),
    "--memory",
    `${memory}m`,
    "--memory-swap",
    `${memory}m`,
    "--cpus",
    String(cpuLimit),
    "--user",
    "65534:65534",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=64m",
    "--mount",
    `type=bind,src=${workspace},dst=/workspace,readonly`,
    "--workdir",
    "/workspace",
    image,
    ...command,
  ];
}

function runCommand(command, args, { stdin = "", timeoutMs, outputLimitBytes = MAX_OUTPUT_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let outputExceeded = false;

    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > outputLimitBytes) {
        outputExceeded = true;
        child.kill("SIGKILL");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= outputLimitBytes) stderr.push(chunk);
    });
    child.once("error", (error) => {
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        outputExceeded,
      });
    });
    child.stdin.end(stdin);
  });
}

async function forceRemoveContainer(runtime, containerName) {
  try {
    await runCommand(runtime, ["rm", "-f", containerName], { timeoutMs: 5000, outputLimitBytes: 4096 });
  } catch {
    // Best-effort cleanup after a timeout or runtime failure.
  }
}

export async function executeAssessmentJob(job, options = {}) {
  if (!job || typeof job !== "object") throw new Error("Assessment job payload is required");
  if (job.networkAccess !== false) throw new Error("Assessment jobs must prohibit network access");
  if (typeof job.sourceText !== "string" || !job.sourceText.trim()) {
    throw new Error("Assessment worker currently requires sourceText submissions");
  }

  const runtime = String(options.runtime || process.env.ASSESSMENT_CONTAINER_RUNTIME || "docker").trim();
  if (!new Set(["docker", "podman"]).has(runtime)) {
    throw new Error("ASSESSMENT_CONTAINER_RUNTIME must be docker or podman");
  }

  const language = resolveLanguage(job.language, options.env || process.env);
  if (!language.image) throw new Error(`No sandbox image configured for ${language.key}`);
  const policy = parseRunnerPolicy(job.runnerPolicy);
  const workspace = await mkdtemp(join(tmpdir(), "interview-assessment-"));
  const sourcePath = join(workspace, language.filename);
  await writeFile(sourcePath, job.sourceText, { encoding: "utf8", mode: 0o444 });
  await chmod(workspace, 0o555);

  const details = [];
  let passedTests = 0;
  let status = "passed";
  const totalTimeLimitMs = boundedInteger(Number(job.timeLimitMs), 60_000, 1_000, 600_000);
  const deadline = Date.now() + totalTimeLimitMs;

  try {
    for (let index = 0; index < policy.testCases.length; index += 1) {
      const testCase = policy.testCases[index];
      const containerName = `interview-assessment-${String(job.jobId || randomUUID()).replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 40)}-${index}-${randomUUID().slice(0, 8)}`;
      const args = buildContainerRunArgs({
        containerName,
        workspace,
        image: language.image,
        command: language.command,
        memoryLimitMb: job.memoryLimitMb,
        cpuLimit: policy.cpuLimit,
        pidsLimit: policy.pidsLimit,
      });
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        status = "timeout";
        details.push({ name: testCase.name, passed: false, status: "total_timeout", durationMs: 0 });
        break;
      }
      const startedAt = Date.now();
      let execution;
      try {
        execution = await runCommand(runtime, args, {
          stdin: testCase.stdin,
          timeoutMs: Math.min(policy.executionTimeoutMs, remainingMs),
        });
      } catch (error) {
        await forceRemoveContainer(runtime, containerName);
        throw error;
      }
      const durationMs = Date.now() - startedAt;

      if (execution.signal === "SIGKILL" && !execution.outputExceeded) {
        await forceRemoveContainer(runtime, containerName);
        status = "timeout";
        details.push({ name: testCase.name, passed: false, status: "timeout", durationMs });
        break;
      }
      if (execution.outputExceeded) {
        status = "runtime_error";
        details.push({ name: testCase.name, passed: false, status: "output_limit", durationMs });
        break;
      }
      if (execution.code !== 0) {
        status = "runtime_error";
        details.push({
          name: testCase.name,
          passed: false,
          status: "runtime_error",
          exitCode: execution.code,
          durationMs,
          stderr: execution.stderr.slice(0, 4000),
        });
        break;
      }

      const actual = normalizeText(execution.stdout);
      const expected = normalizeText(testCase.expectedStdout);
      const passed = actual === expected;
      if (passed) passedTests += 1;
      else status = "failed";
      details.push({
        name: testCase.name,
        passed,
        status: passed ? "passed" : "failed",
        durationMs,
        actualStdout: actual.slice(0, 4000),
      });
    }
  } finally {
    await chmod(workspace, 0o700).catch(() => undefined);
    await rm(workspace, { recursive: true, force: true });
  }

  return {
    status,
    passedTests,
    totalTests: policy.testCases.length,
    rawScore: passedTests,
    runnerType: `container-${runtime}`,
    runnerVersion: "assessment-worker-v1",
    details: {
      language: language.key,
      image: language.image,
      networkAccess: false,
      rootFilesystemReadOnly: true,
      capabilitiesDropped: true,
      noNewPrivileges: true,
      totalTimeLimitMs,
      tests: details,
    },
  };
}
