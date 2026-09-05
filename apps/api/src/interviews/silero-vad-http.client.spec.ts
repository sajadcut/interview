import assert from "node:assert/strict";
import test from "node:test";
import { resetEnvCacheForTests } from "../config/env";
import {
  computeVadRetryDelayMs,
  mapVadHttpFailure,
  SILERO_VAD_CONTRACT_VERSION,
  SileroVadHttpClient,
  VadClientError,
} from "./silero-vad-http.client";

const VAD_ENV_KEYS = [
  "NODE_ENV",
  "VAD_PROVIDER",
  "VAD_BASE_URL",
  "MEDIA_PROVIDER_TIMEOUT_MS",
  "MEDIA_WORKER_SHARED_SECRET",
  "LLM_PROVIDER",
  "STT_PROVIDER",
  "MEDIA_TRANSPORT_PROVIDER",
  "TTS_PROVIDER",
] as const;

async function withVadEnv(
  values: Partial<Record<(typeof VAD_ENV_KEYS)[number], string>>,
  run: () => Promise<void> | void,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of VAD_ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  Object.assign(process.env, values);
  resetEnvCacheForTests();
  try {
    await run();
  } finally {
    for (const key of VAD_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvCacheForTests();
  }
}

function successPayload(requestId: string) {
  return {
    contractVersion: SILERO_VAD_CONTRACT_VERSION,
    provider: "silero-vad",
    requestId,
    speechDetected: true,
    sampleRate: 16000,
    durationSeconds: 0.05,
    segments: [{ startSeconds: 0.01, endSeconds: 0.04 }],
  };
}

function successResponse(requestId: string): Response {
  return new Response(JSON.stringify(successPayload(requestId)), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-vad-contract-version": SILERO_VAD_CONTRACT_VERSION,
    },
  });
}

test("VAD retry delays are bounded exponential", () => {
  assert.equal(computeVadRetryDelayMs(1), 100);
  assert.equal(computeVadRetryDelayMs(2), 200);
  assert.equal(computeVadRetryDelayMs(20), 5000);
  assert.equal(computeVadRetryDelayMs(1, 9000), 5000);
});

test("VAD HTTP failures have stable retry semantics", () => {
  const unavailable = mapVadHttpFailure(503, 1, "vad-request-001");
  assert.equal(unavailable.code, "provider_unavailable");
  assert.equal(unavailable.retryable, true);
  const invalid = mapVadHttpFailure(422, 1, "vad-request-001");
  assert.equal(invalid.code, "invalid_audio");
  assert.equal(invalid.retryable, false);
});

test("disabled VAD is optional and never probes any provider", async () => {
  await withVadEnv({ NODE_ENV: "test", VAD_PROVIDER: "disabled" }, async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("should not run");
    };
    try {
      const client = new SileroVadHttpClient();
      assert.equal(client.enabled, false);
      assert.deepEqual(await client.readiness(), {
        reachable: false,
        ready: false,
        reason: "vad_disabled",
      });
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("VAD readiness touches only the configured VAD endpoint even when other realtime providers are disabled", async () => {
  await withVadEnv(
    {
      NODE_ENV: "test",
      VAD_PROVIDER: "silero-http",
      VAD_BASE_URL: "http://127.0.0.1:9030",
      MEDIA_WORKER_SHARED_SECRET: "test-vad-secret",
      LLM_PROVIDER: "disabled",
      STT_PROVIDER: "disabled",
      MEDIA_TRANSPORT_PROVIDER: "disabled",
      TTS_PROVIDER: "disabled",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify({
            contractVersion: SILERO_VAD_CONTRACT_VERSION,
            provider: "silero-vad",
            ready: true,
            targetSampleRate: 16000,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-vad-contract-version": SILERO_VAD_CONTRACT_VERSION,
            },
          },
        );
      };
      try {
        assert.deepEqual(await new SileroVadHttpClient().readiness(), {
          reachable: true,
          ready: true,
          contractVersion: SILERO_VAD_CONTRACT_VERSION,
        });
        assert.deepEqual(urls, ["http://127.0.0.1:9030/health"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("VAD client sends versioned WAV and validates structured segments", async () => {
  await withVadEnv(
    {
      NODE_ENV: "test",
      VAD_PROVIDER: "silero-http",
      VAD_BASE_URL: "http://127.0.0.1:9030",
      MEDIA_WORKER_SHARED_SECRET: "test-vad-secret",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      const requestId = "vad-request-002";
      let headers: Headers | undefined;
      let bodyLength = 0;
      globalThis.fetch = async (_input, init) => {
        headers = new Headers(init?.headers);
        bodyLength = Buffer.from(init?.body as Uint8Array).byteLength;
        return successResponse(requestId);
      };
      try {
        const result = await new SileroVadHttpClient().analyze({
          audio: Uint8Array.from([1, 2, 3, 4]),
          contentType: "audio/wav",
          requestId,
        });
        assert.equal(result.requestId, requestId);
        assert.equal(result.provider, "silero-vad");
        assert.equal(result.speechDetected, true);
        assert.deepEqual(result.segments, [{ startSeconds: 0.01, endSeconds: 0.04 }]);
        assert.equal(headers?.get("x-vad-contract-version"), SILERO_VAD_CONTRACT_VERSION);
        assert.equal(headers?.get("x-vad-secret"), "test-vad-secret");
        assert.equal(bodyLength, 4);
        assert.equal(JSON.stringify(result).includes("test-vad-secret"), false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("VAD retries transient provider failure with the same request id", async () => {
  await withVadEnv(
    {
      NODE_ENV: "test",
      VAD_PROVIDER: "silero-http",
      VAD_BASE_URL: "http://127.0.0.1:9030",
      MEDIA_WORKER_SHARED_SECRET: "test-vad-secret",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      const requestId = "vad-request-003";
      const ids: string[] = [];
      let calls = 0;
      globalThis.fetch = async (_input, init) => {
        calls += 1;
        ids.push(new Headers(init?.headers).get("x-request-id") ?? "");
        if (calls === 1) {
          return new Response(null, { status: 503, headers: { "retry-after": "0" } });
        }
        return successResponse(requestId);
      };
      try {
        const result = await new SileroVadHttpClient().analyze({
          audio: Uint8Array.from([1]),
          contentType: "audio/wav",
          requestId,
        });
        assert.equal(result.attempts, 2);
        assert.deepEqual(ids, [requestId, requestId]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("VAD rejects malformed or overlapping structured segments without retry", async () => {
  await withVadEnv(
    {
      NODE_ENV: "test",
      VAD_PROVIDER: "silero-http",
      VAD_BASE_URL: "http://127.0.0.1:9030",
      MEDIA_WORKER_SHARED_SECRET: "test-vad-secret",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        const payload = {
          ...successPayload("vad-request-004"),
          segments: [
            { startSeconds: 0.01, endSeconds: 0.04 },
            { startSeconds: 0.02, endSeconds: 0.045 },
          ],
        };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-vad-contract-version": SILERO_VAD_CONTRACT_VERSION,
          },
        });
      };
      try {
        await assert.rejects(
          () =>
            new SileroVadHttpClient().analyze({
              audio: Uint8Array.from([1]),
              contentType: "audio/wav",
              requestId: "vad-request-004",
            }),
          (error: unknown) =>
            error instanceof VadClientError &&
            error.code === "invalid_response" &&
            error.retryable === false,
        );
        assert.equal(calls, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("VAD production configuration fails closed on insecure transport or weak secret", async () => {
  await withVadEnv(
    {
      NODE_ENV: "production",
      VAD_PROVIDER: "silero-http",
      VAD_BASE_URL: "http://vad.internal.test",
      MEDIA_WORKER_SHARED_SECRET: "weak",
    },
    () => {
      const client = new SileroVadHttpClient();
      assert.equal(client.enabled, true);
      assert.equal(client.configured, false);
    },
  );
});
