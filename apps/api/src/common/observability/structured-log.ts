import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { redactSensitiveValue } from "../security/redaction";
import { currentTraceContext } from "./trace-context";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type LogBodyMode = "off" | "metadata" | "full";

interface ObservabilityConfig {
  serviceName: string;
  level: LogLevel;
  consoleEnabled: boolean;
  fileEnabled: boolean;
  filePath: string;
  rotateMaxBytes: number;
  rotateMaxFiles: number;
  bodyMode: LogBodyMode;
  maxBodyBytes: number;
  httpEnabled: boolean;
  outboundEnabled: boolean;
  tracePropagationEnabled: boolean;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

let cached: ObservabilityConfig | undefined;
let currentFileSize = 0;
let sizeInitialized = false;

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function levelEnv(): LogLevel {
  const value = (process.env.LOG_LEVEL ?? "info").trim().toLowerCase();
  return (["trace", "debug", "info", "warn", "error", "fatal"] as const).includes(value as LogLevel)
    ? value as LogLevel
    : "info";
}

function bodyModeEnv(): LogBodyMode {
  const value = (process.env.LOG_BODY_MODE ?? "metadata").trim().toLowerCase();
  return (["off", "metadata", "full"] as const).includes(value as LogBodyMode)
    ? value as LogBodyMode
    : "metadata";
}

export function getObservabilityConfig(): ObservabilityConfig {
  if (cached) return cached;
  const serviceName = (process.env.LOG_SERVICE_NAME ?? "interview-api").trim() || "interview-api";
  const logDir = (process.env.LOG_DIR ?? ".local-data/logs").trim() || ".local-data/logs";
  const basename = (process.env.LOG_FILE_BASENAME ?? serviceName).trim() || serviceName;
  const directory = isAbsolute(logDir) ? logDir : resolve(process.cwd(), logDir);
  cached = {
    serviceName,
    level: levelEnv(),
    consoleEnabled: boolEnv("LOG_CONSOLE_ENABLED", true),
    fileEnabled: boolEnv("LOG_FILE_ENABLED", true),
    filePath: resolve(directory, `${basename}.log`),
    rotateMaxBytes: intEnv("LOG_ROTATE_MAX_BYTES", 100 * 1024 * 1024, 1024 * 1024, 1024 * 1024 * 1024),
    rotateMaxFiles: intEnv("LOG_ROTATE_MAX_FILES", 10, 1, 100),
    bodyMode: bodyModeEnv(),
    maxBodyBytes: intEnv("LOG_MAX_BODY_BYTES", 512 * 1024, 1024, 10 * 1024 * 1024),
    httpEnabled: boolEnv("LOG_HTTP_ENABLED", true),
    outboundEnabled: boolEnv("LOG_OUTBOUND_HTTP_ENABLED", true),
    tracePropagationEnabled: boolEnv("TRACE_PROPAGATION_ENABLED", true),
  };
  return cached;
}

export function resetObservabilityConfigForTests(): void {
  cached = undefined;
  sizeInitialized = false;
  currentFileSize = 0;
}

function rotate(config: ObservabilityConfig): void {
  mkdirSync(dirname(config.filePath), { recursive: true });
  for (let index = config.rotateMaxFiles - 1; index >= 1; index -= 1) {
    const source = `${config.filePath}.${index}`;
    const target = `${config.filePath}.${index + 1}`;
    if (!existsSync(source)) continue;
    if (index + 1 > config.rotateMaxFiles) {
      unlinkSync(source);
      continue;
    }
    if (existsSync(target)) unlinkSync(target);
    renameSync(source, target);
  }
  if (existsSync(config.filePath)) {
    const first = `${config.filePath}.1`;
    if (existsSync(first)) unlinkSync(first);
    renameSync(config.filePath, first);
  }
  currentFileSize = 0;
  sizeInitialized = true;
}

function appendLine(line: string, config: ObservabilityConfig): void {
  if (!config.fileEnabled) return;
  mkdirSync(dirname(config.filePath), { recursive: true });
  if (!sizeInitialized) {
    currentFileSize = existsSync(config.filePath) ? statSync(config.filePath).size : 0;
    sizeInitialized = true;
  }
  const bytes = Buffer.byteLength(line, "utf8");
  if (currentFileSize > 0 && currentFileSize + bytes > config.rotateMaxBytes) rotate(config);
  appendFileSync(config.filePath, line, { encoding: "utf8", mode: 0o600 });
  currentFileSize += bytes;
}

function shouldWrite(level: LogLevel, config: ObservabilityConfig): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[config.level];
}

export function writeStructuredLog(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const config = getObservabilityConfig();
  if (!shouldWrite(level, config)) return;

  const trace = currentTraceContext();
  const payload = redactSensitiveValue({
    time: new Date().toISOString(),
    level,
    service: config.serviceName,
    event,
    ...(trace ? {
      traceId: trace.traceId,
      requestId: trace.requestId,
      spanId: trace.spanId,
      ...(trace.parentSpanId ? { parentSpanId: trace.parentSpanId } : {}),
      ...(trace.jobId ? { jobId: trace.jobId } : {}),
      ...(trace.capability ? { capability: trace.capability } : {}),
    } : {}),
    ...fields,
  });
  const line = `${JSON.stringify(payload)}\n`;

  if (config.consoleEnabled) {
    const printable = line.trimEnd();
    if (level === "error" || level === "fatal") console.error(printable);
    else if (level === "warn") console.warn(printable);
    else console.log(printable);
  }
  appendLine(line, config);
}

function utf8Truncate(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const buffer = Buffer.from(value, "utf8").subarray(0, maxBytes);
  return `${buffer.toString("utf8")}…[TRUNCATED]`;
}

export function loggableBody(value: unknown, contentType?: string | null): unknown {
  const config = getObservabilityConfig();
  if (config.bodyMode === "off") return undefined;
  if (value === undefined || value === null) return value;

  if (config.bodyMode === "metadata") {
    if (typeof value === "string") return { kind: "text", bytes: Buffer.byteLength(value, "utf8") };
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { kind: "binary", bytes: value.byteLength };
    if (typeof value === "object") {
      try {
        return { kind: "json", bytes: Buffer.byteLength(JSON.stringify(value), "utf8") };
      } catch {
        return { kind: "object" };
      }
    }
    return { kind: typeof value };
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { kind: "binary", bytes: value.byteLength, contentType: contentType ?? undefined };
  }
  if (typeof value === "string") {
    const truncated = utf8Truncate(value, config.maxBodyBytes);
    const normalizedType = contentType?.toLowerCase() ?? "";
    if (normalizedType.includes("application/json")) {
      try {
        return JSON.parse(truncated);
      } catch {
        return truncated;
      }
    }
    return truncated;
  }
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > config.maxBodyBytes) {
      return utf8Truncate(serialized, config.maxBodyBytes);
    }
  } catch {
    return String(value);
  }
  return value;
}

export function logFilePath(): string {
  return getObservabilityConfig().filePath;
}
