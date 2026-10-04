import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runWithTraceContext } from "./trace-context";
import {
  logFilePath,
  resetObservabilityConfigForTests,
  writeStructuredLog,
} from "./structured-log";

test("structured log writes trace ids and redacts secrets in full-body mode", () => {
  const directory = mkdtempSync(join(tmpdir(), "interview-observability-"));
  const previous = {
    LOG_DIR: process.env.LOG_DIR,
    LOG_FILE_BASENAME: process.env.LOG_FILE_BASENAME,
    LOG_FILE_ENABLED: process.env.LOG_FILE_ENABLED,
    LOG_CONSOLE_ENABLED: process.env.LOG_CONSOLE_ENABLED,
    LOG_BODY_MODE: process.env.LOG_BODY_MODE,
  };
  try {
    process.env.LOG_DIR = directory;
    process.env.LOG_FILE_BASENAME = "api-test";
    process.env.LOG_FILE_ENABLED = "true";
    process.env.LOG_CONSOLE_ENABLED = "false";
    process.env.LOG_BODY_MODE = "full";
    resetObservabilityConfigForTests();

    runWithTraceContext(
      {
        traceId: "0123456789abcdef0123456789abcdef",
        requestId: "request-12345678",
        spanId: "0123456789abcdef",
      },
      () => {
        writeStructuredLog("info", "test.event", {
          authorization: "Bearer super-secret-provider-token",
          body: {
            prompt: "candidate analysis",
            apiKey: "raw-api-key",
          },
        });
      },
    );

    const line = readFileSync(logFilePath(), "utf8").trim();
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assert.equal(parsed.traceId, "0123456789abcdef0123456789abcdef");
    assert.equal(parsed.requestId, "request-12345678");
    assert.equal(parsed.event, "test.event");
    assert.doesNotMatch(line, /super-secret-provider-token|raw-api-key/);
    assert.match(line, /\[REDACTED\]/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetObservabilityConfigForTests();
    rmSync(directory, { recursive: true, force: true });
  }
});
