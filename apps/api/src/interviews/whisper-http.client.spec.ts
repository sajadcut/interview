import assert from "node:assert/strict";
import test from "node:test";
import { getEnv, resetEnvCacheForTests } from "../config/env";
import {
  computeWhisperRetryDelayMs,
  mapWhisperHttpFailure,
  WHISPER_STT_CONTRACT_VERSION,
  WhisperClientError,
  WhisperHttpClient,
} from "./whisper-http.client";

const STT_ENV_KEYS = [
  "NODE_ENV",
  "STT_PROVIDER",
  "STT_BASE_URL",
  "STT_REQUEST_TIMEOUT_MS",
  "STT_MAX_ATTEMPTS",
  "STT_RETRY_BASE_MS",
  "MEDIA_PROVIDER_TIMEOUT_MS",
  "MEDIA_WORKER_SHARED_SECRET",
] as const;

async function withSttEnv(
  values: Partial<Record<(typeof STT_ENV_KEYS)[number], string>>,
  run: () => Promise<void> | void,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of STT_ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  Object.assign(process.env, values);
  resetEnvCacheForTests();
  try {
    await run();
  } finally {
    for (const key of STT_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvCacheForTests();
  }
}

function successResponse(requestId: string, text = "hello"): Response {
  return new Response(
    JSON.stringify({
      contractVersion: WHISPER_STT_CONTRACT_VERSION,
      requestId,
      provider: "whisper.cpp",
      text,
      isFinal: true,
      language: "en",
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-stt-contract-version": WHISPER_STT_CONTRACT_VERSION,
      },
    },
  );
}

test("Whisper retry delays are exponential, capped and Retry-After aware", () => {
  assert.equal(computeWhisperRetryDelayMs(1, 250), 250);
  assert.equal(computeWhisperRetryDelayMs(2, 250), 500);
  assert.equal(computeWhisperRetryDelayMs(20, 250), 5000);
  assert.equal(computeWhisperRetryDelayMs(1, 250, 1200), 1200);
  assert.equal(computeWhisperRetryDelayMs(1, 250, 9000), 5000);
});

test("Whisper HTTP errors have stable retry semantics", () => {
  const requestId = "request-test-001";
  const unavailable = mapWhisperHttpFailure(503, 2, requestId);
  assert.equal(unavailable.code, "provider_unavailable");
  assert.equal(unavailable.retryable, true);
  assert.equal(unavailable.attempts, 2);
  const invalid = mapWhisperHttpFailure(415, 1, requestId);
  assert.equal(invalid.code, "unsupported_media_type");
  assert.equal(invalid.retryable, false);
});

test("disabled Whisper integration is optional and never probes", async () => {
  await withSttEnv({ NODE_ENV: "test", STT_PROVIDER: "disabled" }, async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("should not be called");
    };
    try {
      const client = new WhisperHttpClient();
      assert.equal(client.enabled, false);
      assert.equal(client.configured, false);
      assert.deepEqual(await client.readiness(), {
        reachable: false,
        ready: false,
        reason: "stt_disabled",
      });
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("Whisper readiness validates the contract version without exposing the shared secret", async () => {
  await withSttEnv(
    {
      NODE_ENV: "test",
      STT_PROVIDER: "whisper-http",
      STT_BASE_URL: "http://127.0.0.1:9010/stt",
      MEDIA_WORKER_SHARED_SECRET: "test-media-secret",
      MEDIA_PROVIDER_TIMEOUT_MS: "500",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      let requestedUrl = "";
      globalThis.fetch = async (input) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({
            contractVersion: WHISPER_STT_CONTRACT_VERSION,
            provider: "whisper.cpp",
            ready: true,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-stt-contract-version": WHISPER_STT_CONTRACT_VERSION,
            },
          },
        );
      };
      try {
        const client = new WhisperHttpClient();
        assert.deepEqual(await client.readiness(), {
          reachable: true,
          ready: true,
          contractVersion: WHISPER_STT_CONTRACT_VERSION,
        });
        assert.equal(requestedUrl, "http://127.0.0.1:9010/stt/health");
        assert.equal(JSON.stringify(client.deploymentStatus()).includes("test-media-secret"), false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("Whisper client sends versioned WAV requests and returns only validated final transcripts", async () => {
  await withSttEnv(
    {
      NODE_ENV: "test",
      STT_PROVIDER: "whisper-http",
      STT_BASE_URL: "http://127.0.0.1:9010/stt",
      MEDIA_WORKER_SHARED_SECRET: "test-media-secret",
      STT_REQUEST_TIMEOUT_MS: "1000",
      STT_MAX_ATTEMPTS: "2",
      STT_RETRY_BASE_MS: "50",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      const requestId = "request-test-002";
      let observedHeaders: Headers | undefined;
      let observedBodyLength = 0;
      globalThis.fetch = async (_input, init) => {
        observedHeaders = new Headers(init?.headers);
        observedBodyLength = Buffer.from(init?.body as Uint8Array).byteLength;
        return successResponse(requestId, "hello world");
      };
      try {
        const result = await new WhisperHttpClient().transcribe({
          audio: Uint8Array.from([1, 2, 3, 4]),
          contentType: "audio/wav",
          requestId,
        });
        assert.equal(result.text, "hello world");
        assert.equal(result.attempts, 1);
        assert.equal(result.requestId, requestId);
        assert.equal(observedHeaders?.get("x-stt-contract-version"), WHISPER_STT_CONTRACT_VERSION);
        assert.equal(observedHeaders?.get("x-request-id"), requestId);
        assert.equal(observedHeaders?.get("x-media-worker-secret"), "test-media-secret");
        assert.equal(observedBodyLength, 4);
        assert.equal(JSON.stringify(result).includes("test-media-secret"), false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("Whisper client retries retryable provider failures with the same request id", async () => {
  await withSttEnv(
    {
      NODE_ENV: "test",
      STT_PROVIDER: "whisper-http",
      STT_BASE_URL: "http://127.0.0.1:9010/stt",
      MEDIA_WORKER_SHARED_SECRET: "test-media-secret",
      STT_REQUEST_TIMEOUT_MS: "1000",
      STT_MAX_ATTEMPTS: "2",
      STT_RETRY_BASE_MS: "50",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      const requestId = "request-test-003";
      const requestIds: string[] = [];
      let calls = 0;
      globalThis.fetch = async (_input, init) => {
        calls += 1;
        requestIds.push(new Headers(init?.headers).get("x-request-id") ?? "");
        if (calls === 1) {
          return new Response(null, { status: 503, headers: { "retry-after": "0" } });
        }
        return successResponse(requestId, "retried");
      };
      try {
        const result = await new WhisperHttpClient().transcribe({
          audio: Uint8Array.from([1, 2, 3]),
          contentType: "audio/wav",
          requestId,
        });
        assert.equal(result.text, "retried");
        assert.equal(result.attempts, 2);
        assert.deepEqual(requestIds, [requestId, requestId]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("Whisper client does not retry deterministic request failures", async () => {
  await withSttEnv(
    {
      NODE_ENV: "test",
      STT_PROVIDER: "whisper-http",
      STT_BASE_URL: "http://127.0.0.1:9010/stt",
      MEDIA_WORKER_SHARED_SECRET: "test-media-secret",
      STT_MAX_ATTEMPTS: "3",
      STT_RETRY_BASE_MS: "50",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return new Response(null, { status: 415 });
      };
      try {
        await assert.rejects(
          () =>
            new WhisperHttpClient().transcribe({
              audio: Uint8Array.from([1]),
              contentType: "audio/wav",
              requestId: "request-test-004",
            }),
          (error: unknown) =>
            error instanceof WhisperClientError &&
            error.code === "unsupported_media_type" &&
            error.retryable === false &&
            error.attempts === 1,
        );
        assert.equal(calls, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("Whisper client maps exhausted request timeouts without leaking upstream text", async () => {
  await withSttEnv(
    {
      NODE_ENV: "test",
      STT_PROVIDER: "whisper-http",
      STT_BASE_URL: "http://127.0.0.1:9010/stt",
      MEDIA_WORKER_SHARED_SECRET: "test-media-secret",
      STT_MAX_ATTEMPTS: "2",
      STT_RETRY_BASE_MS: "50",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        throw new DOMException("sensitive network diagnostics", "TimeoutError");
      };
      try {
        await assert.rejects(
          () =>
            new WhisperHttpClient().transcribe({
              audio: Uint8Array.from([1]),
              contentType: "audio/wav",
              requestId: "request-test-005",
            }),
          (error: unknown) =>
            error instanceof WhisperClientError &&
            error.code === "client_timeout" &&
            error.retryable === true &&
            error.attempts === 2 &&
            !error.message.includes("sensitive network diagnostics"),
        );
        assert.equal(calls, 2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("Whisper production configuration requires HTTPS and a strong media-worker secret", async () => {
  await withSttEnv(
    {
      NODE_ENV: "production",
      STT_PROVIDER: "whisper-http",
      STT_BASE_URL: "http://media.internal.test/stt",
      MEDIA_WORKER_SHARED_SECRET: "secret",
    },
    () => {
      assert.throws(
        () => getEnv(),
        /STT_BASE_URL: production Whisper transport must use https:\/\/.*MEDIA_WORKER_SHARED_SECRET: production media-worker secret must be at least 32 bytes/,
      );
    },
  );
});
