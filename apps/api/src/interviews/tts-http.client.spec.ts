import assert from "node:assert/strict";
import test from "node:test";
import { resetEnvCacheForTests } from "../config/env";
import {
  computeTtsRetryDelayMs,
  mapTtsHttpFailure,
  TTS_CONTRACT_VERSION,
  TtsClientError,
  TtsHttpClient,
} from "./tts-http.client";

const TTS_ENV_KEYS = [
  "NODE_ENV",
  "TTS_PROVIDER",
  "TTS_BASE_URL",
  "MEDIA_PROVIDER_TIMEOUT_MS",
  "MEDIA_WORKER_SHARED_SECRET",
  "LLM_PROVIDER",
  "STT_PROVIDER",
  "MEDIA_TRANSPORT_PROVIDER",
] as const;

async function withTtsEnv(
  values: Partial<Record<(typeof TTS_ENV_KEYS)[number], string>>,
  run: () => Promise<void> | void,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of TTS_ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  Object.assign(process.env, values);
  resetEnvCacheForTests();
  try {
    await run();
  } finally {
    for (const key of TTS_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvCacheForTests();
  }
}

function wavBytes(): Uint8Array {
  const bytes = new Uint8Array(44);
  bytes.set(Buffer.from("RIFF"), 0);
  bytes.set(Buffer.from("WAVE"), 8);
  return bytes;
}

function successResponse(requestId: string): Response {
  const audio = wavBytes();
  return new Response(Buffer.from(audio), {
    status: 200,
    headers: {
      "content-type": "audio/wav",
      "content-length": String(audio.byteLength),
      "x-tts-contract-version": TTS_CONTRACT_VERSION,
      "x-tts-provider": "local-command",
      "x-request-id": requestId,
    },
  });
}

test("TTS retry delays are bounded exponential", () => {
  assert.equal(computeTtsRetryDelayMs(1), 200);
  assert.equal(computeTtsRetryDelayMs(2), 400);
  assert.equal(computeTtsRetryDelayMs(20), 5000);
  assert.equal(computeTtsRetryDelayMs(1, 9000), 5000);
});

test("TTS HTTP failures have stable retry semantics", () => {
  const unavailable = mapTtsHttpFailure(503, 1, "tts-request-001");
  assert.equal(unavailable.code, "provider_unavailable");
  assert.equal(unavailable.retryable, true);
  const invalid = mapTtsHttpFailure(400, 1, "tts-request-001");
  assert.equal(invalid.code, "invalid_request");
  assert.equal(invalid.retryable, false);
});

test("disabled TTS is optional and never probes any provider", async () => {
  await withTtsEnv({ NODE_ENV: "test", TTS_PROVIDER: "disabled" }, async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("should not run");
    };
    try {
      const client = new TtsHttpClient();
      assert.equal(client.enabled, false);
      assert.deepEqual(await client.readiness(), { reachable: false, ready: false, reason: "tts_disabled" });
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("TTS readiness touches only the configured TTS endpoint even when other realtime providers are disabled", async () => {
  await withTtsEnv(
    {
      NODE_ENV: "test",
      TTS_PROVIDER: "local-http",
      TTS_BASE_URL: "http://127.0.0.1:9020",
      MEDIA_WORKER_SHARED_SECRET: "test-tts-secret",
      LLM_PROVIDER: "disabled",
      STT_PROVIDER: "disabled",
      MEDIA_TRANSPORT_PROVIDER: "disabled",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify({ contractVersion: TTS_CONTRACT_VERSION, provider: "local-command", ready: true }),
          {
            status: 200,
            headers: { "content-type": "application/json", "x-tts-contract-version": TTS_CONTRACT_VERSION },
          },
        );
      };
      try {
        assert.deepEqual(await new TtsHttpClient().readiness(), {
          reachable: true,
          ready: true,
          contractVersion: TTS_CONTRACT_VERSION,
        });
        assert.deepEqual(urls, ["http://127.0.0.1:9020/health"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("TTS client sends versioned text request and validates WAV response", async () => {
  await withTtsEnv(
    {
      NODE_ENV: "test",
      TTS_PROVIDER: "local-http",
      TTS_BASE_URL: "http://127.0.0.1:9020",
      MEDIA_WORKER_SHARED_SECRET: "test-tts-secret",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      const requestId = "tts-request-002";
      let headers: Headers | undefined;
      let body = "";
      globalThis.fetch = async (_input, init) => {
        headers = new Headers(init?.headers);
        body = String(init?.body ?? "");
        return successResponse(requestId);
      };
      try {
        const result = await new TtsHttpClient().synthesize({ spokenText: "Hello", requestId });
        assert.equal(result.requestId, requestId);
        assert.equal(result.provider, "local-command");
        assert.equal(result.attempts, 1);
        assert.equal(result.contentType, "audio/wav");
        assert.equal(headers?.get("x-tts-contract-version"), TTS_CONTRACT_VERSION);
        assert.equal(headers?.get("x-tts-secret"), "test-tts-secret");
        assert.deepEqual(JSON.parse(body), { spokenText: "Hello" });
        assert.equal(JSON.stringify(result).includes("test-tts-secret"), false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("TTS retries transient provider failure with the same request id", async () => {
  await withTtsEnv(
    {
      NODE_ENV: "test",
      TTS_PROVIDER: "local-http",
      TTS_BASE_URL: "http://127.0.0.1:9020",
      MEDIA_WORKER_SHARED_SECRET: "test-tts-secret",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      const requestId = "tts-request-003";
      const ids: string[] = [];
      let calls = 0;
      globalThis.fetch = async (_input, init) => {
        calls += 1;
        ids.push(new Headers(init?.headers).get("x-request-id") ?? "");
        if (calls === 1) return new Response(null, { status: 503, headers: { "retry-after": "0" } });
        return successResponse(requestId);
      };
      try {
        const result = await new TtsHttpClient().synthesize({ spokenText: "retry", requestId });
        assert.equal(result.attempts, 2);
        assert.deepEqual(ids, [requestId, requestId]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("TTS rejects invalid binary responses and does not retry deterministic contract failure", async () => {
  await withTtsEnv(
    {
      NODE_ENV: "test",
      TTS_PROVIDER: "local-http",
      TTS_BASE_URL: "http://127.0.0.1:9020",
      MEDIA_WORKER_SHARED_SECRET: "test-tts-secret",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return new Response(Buffer.from([1, 2, 3]), {
          status: 200,
          headers: {
            "content-type": "audio/wav",
            "x-tts-contract-version": TTS_CONTRACT_VERSION,
            "x-tts-provider": "local-command",
            "x-request-id": "tts-request-004",
          },
        });
      };
      try {
        await assert.rejects(
          () => new TtsHttpClient().synthesize({ spokenText: "bad", requestId: "tts-request-004" }),
          (error: unknown) => error instanceof TtsClientError && error.code === "invalid_response" && !error.retryable,
        );
        assert.equal(calls, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("TTS production configuration fails closed on insecure transport or weak secret", async () => {
  await withTtsEnv(
    {
      NODE_ENV: "production",
      TTS_PROVIDER: "local-http",
      TTS_BASE_URL: "http://tts.internal.test",
      MEDIA_WORKER_SHARED_SECRET: "weak",
    },
    () => {
      const client = new TtsHttpClient();
      assert.equal(client.enabled, true);
      assert.equal(client.configured, false);
    },
  );
});
