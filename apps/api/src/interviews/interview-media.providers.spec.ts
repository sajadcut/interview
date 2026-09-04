import assert from "node:assert/strict";
import test from "node:test";
import type { AppEnv } from "../config/env";
import { buildMediaProviderDescriptors, probeMediaProviders } from "./interview-media.providers";

function env(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: 4100,
    CORS_ORIGIN: "*",
    SUPERVISED_PILOT_ENABLED: false,
    DATABASE_URL: "postgresql://interview:interview@localhost:5432/interview",
    STORAGE_PROVIDER: "local",
    LOCAL_STORAGE_ROOT: ".local-data/storage",
    S3_REGION: "us-east-1",
    S3_BUCKET: "",
    S3_ACCESS_KEY_ID: "",
    S3_SECRET_ACCESS_KEY: "",
    S3_FORCE_PATH_STYLE: false,
    S3_SIGNED_URL_TTL_SECONDS: 300,
    EMAIL_PROVIDER: "disabled",
    EMAIL_FROM_ADDRESS: "",
    EMAIL_FROM_NAME: "Interview Platform",
    EMAIL_REPLY_TO: "",
    EMAIL_TIMEOUT_MS: 10000,
    EMAIL_MAX_ATTEMPTS: 3,
    EMAIL_RETRY_BASE_MS: 250,
    SMTP_HOST: "",
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_REQUIRE_TLS: true,
    SMTP_USERNAME: "",
    SMTP_PASSWORD: "",
    SMTP_TLS_SERVERNAME: "",
    SES_REGION: "us-east-1",
    SES_ACCESS_KEY_ID: "",
    SES_SECRET_ACCESS_KEY: "",
    SES_SESSION_TOKEN: "",
    SENDGRID_API_KEY: "",
    LLM_PROVIDER: "disabled",
    LLM_MODEL: "",
    LLM_API_KEY: "",
    EMBEDDING_PROVIDER: "disabled",
    EMBEDDING_MODEL: "",
    EMBEDDING_API_KEY: "",
    EMBEDDING_TIMEOUT_MS: 10000,
    MEDIA_REALTIME_ENABLED: false,
    MEDIA_PROVIDER_TIMEOUT_MS: 2500,
    MEDIA_WORKER_SHARED_SECRET: "",
    MEDIA_TRANSPORT_PROVIDER: "disabled",
    LIVEKIT_API_KEY: "",
    LIVEKIT_API_SECRET: "",
    LIVEKIT_TOKEN_TTL_SECONDS: 300,
    TURN_URLS: "",
    VAD_PROVIDER: "disabled",
    STT_PROVIDER: "disabled",
    STT_REQUEST_TIMEOUT_MS: 130000,
    STT_MAX_ATTEMPTS: 3,
    STT_RETRY_BASE_MS: 250,
    TTS_PROVIDER: "disabled",
    AVATAR_PROVIDER: "disabled",
    ...overrides,
  };
}

test("provider descriptors never expose LiveKit credentials", () => {
  const descriptors = buildMediaProviderDescriptors(
    env({
      MEDIA_TRANSPORT_PROVIDER: "livekit",
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_HEALTH_URL: "http://127.0.0.1:7880",
      LIVEKIT_API_KEY: "public-key",
      LIVEKIT_API_SECRET: "very-secret",
    }),
  );
  const serialized = JSON.stringify(descriptors);
  assert.equal(serialized.includes("very-secret"), false);
  assert.equal(serialized.includes("public-key"), false);
  assert.equal(descriptors[0]?.configured, true);
});

test("disabled providers are reported as not configured without probing", async () => {
  let probes = 0;
  const statuses = await probeMediaProviders(
    buildMediaProviderDescriptors(env()),
    100,
    async () => {
      probes += 1;
      return new Response(null, { status: 200 });
    },
  );
  assert.equal(probes, 0);
  assert.ok(statuses.every((status) => status.configured === false && status.ready === false));
});

test("successful health probe marks a configured provider ready", async () => {
  const descriptors = buildMediaProviderDescriptors(
    env({ VAD_PROVIDER: "silero-http", VAD_BASE_URL: "http://127.0.0.1:9010" }),
  ).filter((descriptor) => descriptor.component === "vad");
  const statuses = await probeMediaProviders(descriptors, 100, async (url) => {
    assert.equal(url, "http://127.0.0.1:9010/health");
    return new Response(null, { status: 200, headers: { "x-provider-version": "silero-v1" } });
  });
  assert.equal(statuses[0]?.reachable, true);
  assert.equal(statuses[0]?.ready, true);
  assert.equal(statuses[0]?.version, "silero-v1");
});

test("non-2xx health response is reachable but not ready", async () => {
  const descriptors = buildMediaProviderDescriptors(
    env({ STT_PROVIDER: "whisper-http", STT_BASE_URL: "http://127.0.0.1:9020", MEDIA_WORKER_SHARED_SECRET: "test-secret" }),
  ).filter((descriptor) => descriptor.component === "stt");
  const statuses = await probeMediaProviders(descriptors, 100, async () =>
    new Response(null, { status: 503 }),
  );
  assert.equal(statuses[0]?.reachable, true);
  assert.equal(statuses[0]?.ready, false);
  assert.match(statuses[0]?.reason ?? "", /503/);
});
