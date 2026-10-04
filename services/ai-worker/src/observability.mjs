import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const storage = new AsyncLocalStorage();
const REDACTED = "[REDACTED]";
let installed = false;
let currentFileSize = 0;
let sizeInitialized = false;

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function intEnv(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function config() {
  const serviceName =
    process.env.AI_WORKER_LOG_SERVICE_NAME?.trim() ||
    process.env.LOG_SERVICE_NAME?.trim() ||
    "interview-ai-worker";
  const logDir =
    process.env.AI_WORKER_LOG_DIR?.trim() ||
    process.env.LOG_DIR?.trim() ||
    ".local-data/logs";
  const basename =
    process.env.AI_WORKER_LOG_FILE_BASENAME?.trim() ||
    "interview-ai-worker";
  const directory = isAbsolute(logDir) ? logDir : resolve(process.cwd(), logDir);
  return {
    serviceName,
    level: (process.env.LOG_LEVEL ?? "info").trim().toLowerCase(),
    consoleEnabled: boolEnv("LOG_CONSOLE_ENABLED", true),
    fileEnabled: boolEnv("LOG_FILE_ENABLED", true),
    filePath: resolve(directory, `${basename}.log`),
    rotateMaxBytes: intEnv("LOG_ROTATE_MAX_BYTES", 104857600, 1048576, 1073741824),
    rotateMaxFiles: intEnv("LOG_ROTATE_MAX_FILES", 10, 1, 100),
    bodyMode: (process.env.LOG_BODY_MODE ?? "metadata").trim().toLowerCase(),
    maxBodyBytes: intEnv("LOG_MAX_BODY_BYTES", 524288, 1024, 10485760),
    outboundEnabled: boolEnv("LOG_OUTBOUND_HTTP_ENABLED", true),
    tracePropagationEnabled: boolEnv("TRACE_PROPAGATION_ENABLED", true),
  };
}

function canonicalKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sensitiveKey(key) {
  const value = canonicalKey(key);
  return (
    value === "authorization" ||
    value === "cookie" ||
    value === "password" ||
    value === "passphrase" ||
    value === "otp" ||
    value === "apikey" ||
    value === "privatekey" ||
    value.endsWith("password") ||
    value.endsWith("passphrase") ||
    value.endsWith("secret") ||
    value.endsWith("token") ||
    value.endsWith("apikey") ||
    value.endsWith("privatekey") ||
    value.startsWith("authorization") ||
    value.startsWith("cookie") ||
    value.startsWith("credential")
  );
}

function redactString(input) {
  return String(input)
    .replace(/([?&](?:access_token|refresh_token|token|password|secret|api_key|apikey|otp)=)([^&#\s]+)/gi, "$1[REDACTED]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [REDACTED]")
    .replace(/\b(password|secret|token|cookie|credential|api[_-]?key|private[_-]?key|otp)\s*[:=]\s*([^\s,;&]+)/gi, "$1=[REDACTED]");
}

function redact(value, seen = new WeakSet(), depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (depth > 10) return "[MAX_DEPTH]";
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack ? redactString(value.stack) : undefined };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[Binary ${value.byteLength} bytes]`;
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKey(key) ? REDACTED : redact(entry, seen, depth + 1),
    ]),
  );
}

function rotate(cfg) {
  mkdirSync(dirname(cfg.filePath), { recursive: true });
  for (let index = cfg.rotateMaxFiles - 1; index >= 1; index -= 1) {
    const source = `${cfg.filePath}.${index}`;
    const target = `${cfg.filePath}.${index + 1}`;
    if (!existsSync(source)) continue;
    if (index + 1 > cfg.rotateMaxFiles) {
      unlinkSync(source);
      continue;
    }
    if (existsSync(target)) unlinkSync(target);
    renameSync(source, target);
  }
  if (existsSync(cfg.filePath)) {
    const first = `${cfg.filePath}.1`;
    if (existsSync(first)) unlinkSync(first);
    renameSync(cfg.filePath, first);
  }
  currentFileSize = 0;
  sizeInitialized = true;
}

function append(line, cfg) {
  if (!cfg.fileEnabled) return;
  mkdirSync(dirname(cfg.filePath), { recursive: true });
  if (!sizeInitialized) {
    currentFileSize = existsSync(cfg.filePath) ? statSync(cfg.filePath).size : 0;
    sizeInitialized = true;
  }
  const bytes = Buffer.byteLength(line, "utf8");
  if (currentFileSize > 0 && currentFileSize + bytes > cfg.rotateMaxBytes) rotate(cfg);
  appendFileSync(cfg.filePath, line, { encoding: "utf8", mode: 0o600 });
  currentFileSize += bytes;
}

const weights = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

export function currentTraceContext() {
  return storage.getStore();
}

export function newTraceContext(overrides = {}) {
  return {
    traceId: overrides.traceId ?? randomBytes(16).toString("hex"),
    requestId: overrides.requestId ?? randomUUID(),
    spanId: randomBytes(8).toString("hex"),
    ...(overrides.parentSpanId ? { parentSpanId: overrides.parentSpanId } : {}),
    ...(overrides.jobId ? { jobId: overrides.jobId } : {}),
    ...(overrides.capability ? { capability: overrides.capability } : {}),
  };
}

export function withTraceContext(context, callback) {
  return storage.run(context, callback);
}

export function contextFromHeaders(headers = {}) {
  const rawTraceId = Array.isArray(headers["x-trace-id"]) ? headers["x-trace-id"][0] : headers["x-trace-id"];
  const rawRequestId = Array.isArray(headers["x-request-id"]) ? headers["x-request-id"][0] : headers["x-request-id"];
  const traceparent = Array.isArray(headers.traceparent) ? headers.traceparent[0] : headers.traceparent;
  const traceMatch = /^00-([a-f0-9]{32})-([a-f0-9]{16})-[a-f0-9]{2}$/i.exec(String(traceparent ?? "").trim());
  return newTraceContext({
    traceId: traceMatch?.[1]
      ? traceMatch[1].toLowerCase()
      : /^[a-f0-9]{32}$/i.test(String(rawTraceId ?? ""))
        ? String(rawTraceId).toLowerCase()
        : undefined,
    requestId: typeof rawRequestId === "string" && rawRequestId.trim()
      ? rawRequestId.trim().slice(0, 128)
      : undefined,
    parentSpanId: traceMatch?.[2]?.toLowerCase(),
  });
}

export function contextFromJob(job) {
  const observability =
    job?.payload?.observability && typeof job.payload.observability === "object"
      ? job.payload.observability
      : {};
  return newTraceContext({
    traceId: /^[a-f0-9]{32}$/i.test(String(observability.traceId ?? "")) ? String(observability.traceId).toLowerCase() : undefined,
    requestId: typeof observability.requestId === "string" ? observability.requestId : undefined,
    parentSpanId: typeof observability.parentSpanId === "string" ? observability.parentSpanId : undefined,
    jobId: job?.id,
    capability: job?.capability,
  });
}

export function writeLog(level, event, fields = {}) {
  const cfg = config();
  if ((weights[level] ?? 30) < (weights[cfg.level] ?? 30)) return;
  const trace = currentTraceContext();
  const payload = redact({
    time: new Date().toISOString(),
    level,
    service: cfg.serviceName,
    event,
    ...(trace ?? {}),
    ...fields,
  });
  const line = `${JSON.stringify(payload)}\n`;
  if (cfg.consoleEnabled) {
    const printable = line.trimEnd();
    if (level === "error" || level === "fatal") console.error(printable);
    else if (level === "warn") console.warn(printable);
    else console.log(printable);
  }
  append(line, cfg);
}

export const logger = {
  trace: (message, fields = {}) => writeLog("trace", "worker.log", { message, ...fields }),
  debug: (message, fields = {}) => writeLog("debug", "worker.log", { message, ...fields }),
  info: (message, fields = {}) => writeLog("info", "worker.log", { message, ...fields }),
  log: (message, fields = {}) => writeLog("info", "worker.log", { message, ...fields }),
  warn: (message, fields = {}) => writeLog("warn", "worker.log", { message, ...fields }),
  error: (message, fields = {}) => writeLog("error", "worker.log", { message, ...fields }),
};

function bodyForLog(value, contentType = "") {
  const cfg = config();
  if (cfg.bodyMode === "off") return undefined;
  if (value === undefined || value === null) return value;
  if (cfg.bodyMode === "metadata") {
    if (typeof value === "string") return { kind: "text", bytes: Buffer.byteLength(value) };
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { kind: "binary", bytes: value.byteLength };
    try { return { kind: "json", bytes: Buffer.byteLength(JSON.stringify(value)) }; } catch { return { kind: typeof value }; }
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { kind: "binary", bytes: value.byteLength, contentType };
  if (typeof value === "string") {
    const buffer = Buffer.from(value);
    const text = buffer.length > cfg.maxBodyBytes
      ? `${buffer.subarray(0, cfg.maxBodyBytes).toString("utf8")}…[TRUNCATED]`
      : value;
    if (contentType.includes("json")) {
      try { return JSON.parse(text); } catch { return text; }
    }
    return text;
  }
  try {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > cfg.maxBodyBytes) {
      return `${Buffer.from(text).subarray(0, cfg.maxBodyBytes).toString("utf8")}…[TRUNCATED]`;
    }
  } catch {}
  return value;
}

async function responseBody(response) {
  const cfg = config();
  const contentType = response.headers.get("content-type") ?? "";
  if (cfg.bodyMode === "off") return undefined;
  const textual = contentType.includes("json") || contentType.startsWith("text/") || contentType.includes("xml");
  if (!textual) return { kind: "binary", contentType, bytes: Number(response.headers.get("content-length")) || undefined };
  if (cfg.bodyMode === "metadata") return { kind: contentType.includes("json") ? "json" : "text", bytes: Number(response.headers.get("content-length")) || undefined };
  try {
    const text = await response.clone().text();
    return bodyForLog(text, contentType);
  } catch (error) {
    return { kind: "unavailable", error: error instanceof Error ? error.message : String(error) };
  }
}

export function installInstrumentedFetch() {
  if (installed) return;
  installed = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init = {}) => {
    const cfg = config();
    if (!cfg.outboundEnabled) return nativeFetch(input, init);
    const url = input instanceof Request ? input.url : String(input);
    const method = String(init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const trace = currentTraceContext();
    const spanId = randomBytes(8).toString("hex");
    if (trace && cfg.tracePropagationEnabled) {
      if (!headers.has("x-trace-id")) headers.set("x-trace-id", trace.traceId);
      if (!headers.has("x-request-id")) headers.set("x-request-id", trace.requestId);
      if (!headers.has("traceparent")) headers.set("traceparent", `00-${trace.traceId}-${spanId}-01`);
    }

    const started = process.hrtime.bigint();
    writeLog("info", "http.client.request", {
      direction: "outbound",
      clientSpanId: spanId,
      method,
      url,
      headers: Object.fromEntries(headers.entries()),
      body: bodyForLog(init.body, headers.get("content-type") ?? ""),
    });
    try {
      const response = await nativeFetch(input, { ...init, headers });
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      writeLog(response.ok ? "info" : "warn", "http.client.response", {
        direction: "inbound",
        clientSpanId: spanId,
        method,
        url,
        statusCode: response.status,
        durationMs: Number(durationMs.toFixed(3)),
        headers: Object.fromEntries(response.headers.entries()),
        body: await responseBody(response),
      });
      return response;
    } catch (error) {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      writeLog("error", "http.client.error", {
        direction: "inbound",
        clientSpanId: spanId,
        method,
        url,
        durationMs: Number(durationMs.toFixed(3)),
        error,
      });
      throw error;
    }
  };
}

export function logPath() {
  return config().filePath;
}
