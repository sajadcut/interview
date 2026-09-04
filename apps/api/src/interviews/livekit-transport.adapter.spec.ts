import assert from "node:assert/strict";
import test from "node:test";
import { getEnv, resetEnvCacheForTests } from "../config/env";
import { LiveKitTransportAdapter } from "./livekit-transport.adapter";

const LIVEKIT_ENV_KEYS = [
  "NODE_ENV",
  "MEDIA_TRANSPORT_PROVIDER",
  "LIVEKIT_URL",
  "LIVEKIT_HEALTH_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "LIVEKIT_TOKEN_TTL_SECONDS",
  "MEDIA_PROVIDER_TIMEOUT_MS",
  "TURN_URLS",
] as const;

async function withLiveKitEnv(
  values: Partial<Record<(typeof LIVEKIT_ENV_KEYS)[number], string>>,
  run: () => Promise<void> | void,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of LIVEKIT_ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  Object.assign(process.env, values);
  resetEnvCacheForTests();
  try {
    await run();
  } finally {
    for (const key of LIVEKIT_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvCacheForTests();
  }
}

test("disabled LiveKit deployment remains optional", async () => {
  await withLiveKitEnv(
    { NODE_ENV: "test", MEDIA_TRANSPORT_PROVIDER: "disabled" },
    async () => {
      const adapter = new LiveKitTransportAdapter();
      assert.equal(adapter.enabled, false);
      assert.equal(adapter.configured, false);
      assert.deepEqual(await adapter.readiness(), {
        reachable: false,
        ready: false,
        reason: "transport_disabled",
      });
    },
  );
});

test("configured LiveKit deployment probes health and issues a scoped credential", async () => {
  await withLiveKitEnv(
    {
      NODE_ENV: "test",
      MEDIA_TRANSPORT_PROVIDER: "livekit",
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_HEALTH_URL: "http://127.0.0.1:7880/healthz",
      LIVEKIT_API_KEY: "test-api-key",
      LIVEKIT_API_SECRET: "test-api-secret",
      LIVEKIT_TOKEN_TTL_SECONDS: "120",
      MEDIA_PROVIDER_TIMEOUT_MS: "500",
      TURN_URLS: "turn:127.0.0.1:3478?transport=udp",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      const probed: string[] = [];
      globalThis.fetch = async (input) => {
        probed.push(String(input));
        return new Response(null, { status: 204 });
      };
      try {
        const adapter = new LiveKitTransportAdapter();
        assert.equal(adapter.configured, true);
        assert.deepEqual(adapter.deploymentStatus(), {
          provider: "livekit",
          enabled: true,
          configured: true,
          healthCheckConfigured: true,
          turnConfigured: true,
          tokenTtlSeconds: 120,
        });
        assert.deepEqual(await adapter.readiness(), { reachable: true, ready: true });
        const credential = await adapter.issueCredential(
          {
            organizationId: "00000000-0000-0000-0000-000000000001",
            interviewSessionId: "00000000-0000-0000-0000-000000000002",
            mediaSessionId: "00000000-0000-0000-0000-000000000003",
            roomReference: "interview-test-room",
          },
          { participantKey: "candidate-test", participantType: "candidate" },
        );
        assert.equal(credential.provider, "livekit");
        assert.equal(credential.serverUrl, "ws://127.0.0.1:7880");
        assert.equal(credential.roomReference, "interview-test-room");
        assert.equal(credential.participantKey, "candidate-test");
        assert.equal(credential.accessToken.split(".").length, 3);
        assert.equal(credential.accessToken.includes("test-api-secret"), false);
        assert.equal(credential.permissions.roomJoin, true);
        assert.equal(probed.length, 2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("LiveKit readiness exposes bounded failure reasons without upstream error text", async () => {
  await withLiveKitEnv(
    {
      NODE_ENV: "test",
      MEDIA_TRANSPORT_PROVIDER: "livekit",
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_HEALTH_URL: "http://127.0.0.1:7880/healthz",
      LIVEKIT_API_KEY: "test-api-key",
      LIVEKIT_API_SECRET: "test-api-secret",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => new Response("sensitive upstream body", { status: 503 });
      try {
        const readiness = await new LiveKitTransportAdapter().readiness();
        assert.deepEqual(readiness, { reachable: true, ready: false, reason: "http_503" });
        assert.equal(JSON.stringify(readiness).includes("sensitive upstream body"), false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("LiveKit production configuration requires TLS endpoints and a strong secret", async () => {
  await withLiveKitEnv(
    {
      NODE_ENV: "production",
      MEDIA_TRANSPORT_PROVIDER: "livekit",
      LIVEKIT_URL: "ws://livekit.example.test",
      LIVEKIT_HEALTH_URL: "http://livekit.example.test/healthz",
      LIVEKIT_API_KEY: "production-key",
      LIVEKIT_API_SECRET: "secret",
    },
    () => {
      assert.throws(
        () => getEnv(),
        /LIVEKIT_URL: production LiveKit transport must use wss:\/\/.*LIVEKIT_HEALTH_URL: production LiveKit health checks must use https:\/\/.*LIVEKIT_API_SECRET: production LiveKit API secret must be at least 32 bytes/,
      );
    },
  );
});
