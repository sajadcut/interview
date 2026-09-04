import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { z } from "zod";

function loadLocalEnvironment(): void {
  if (process.env.NODE_ENV === "production") return;

  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  for (const file of new Set(candidates)) {
    if (existsSync(file)) {
      loadEnvFile(file);
      return;
    }
  }
}

loadLocalEnvironment();

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);

function booleanEnvironmentFlag(defaultValue: "true" | "false") {
  return z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true");
}

const booleanFlag = booleanEnvironmentFlag("false");
const trueBooleanFlag = booleanEnvironmentFlag("true");
const emailAddress = z.string().email();
const weakDeploymentSecrets = new Set([
  "changeme",
  "change_me",
  "replace_me",
  "replace-me",
  "example",
  "secret",
  "password",
  "livekit-secret",
]);

function urlProtocol(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol;
  } catch {
    return null;
  }
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_HOST: z.string().trim().min(1).default("127.0.0.1"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CORS_ORIGIN: z.string().trim().min(1).default("http://localhost:3000"),
    SUPERVISED_PILOT_ENABLED: booleanFlag,
    DATABASE_URL: z
      .string()
      .min(1)
      .default("postgresql://interview:interview@localhost:5432/interview"),

    STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
    LOCAL_STORAGE_ROOT: z.string().min(1).default(".local-data/storage"),
    S3_ENDPOINT: optionalUrl,
    S3_REGION: z.string().trim().min(1).default("us-east-1"),
    S3_BUCKET: z.string().trim().default(""),
    S3_ACCESS_KEY_ID: z.string().default(""),
    S3_SECRET_ACCESS_KEY: z.string().default(""),
    S3_FORCE_PATH_STYLE: booleanFlag,
    S3_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),

    EMAIL_PROVIDER: z.enum(["disabled", "smtp", "ses", "sendgrid"]).default("disabled"),
    EMAIL_FROM_ADDRESS: z.string().trim().default(""),
    EMAIL_FROM_NAME: z.string().trim().min(1).default("Interview Platform"),
    EMAIL_REPLY_TO: z.string().trim().default(""),
    EMAIL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
    EMAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
    EMAIL_RETRY_BASE_MS: z.coerce.number().int().min(50).max(5_000).default(250),

    SMTP_HOST: z.string().trim().default(""),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    SMTP_SECURE: booleanFlag,
    SMTP_REQUIRE_TLS: trueBooleanFlag,
    SMTP_USERNAME: z.string().default(""),
    SMTP_PASSWORD: z.string().default(""),
    SMTP_TLS_SERVERNAME: z.string().trim().default(""),

    SES_REGION: z.string().trim().min(1).default("us-east-1"),
    SES_ACCESS_KEY_ID: z.string().default(""),
    SES_SECRET_ACCESS_KEY: z.string().default(""),
    SES_SESSION_TOKEN: z.string().default(""),
    SES_ENDPOINT: optionalUrl,

    SENDGRID_API_KEY: z.string().default(""),
    SENDGRID_BASE_URL: optionalUrl,

    LLM_PROVIDER: z.enum(["disabled", "openai-compatible"]).default("disabled"),
    LLM_MODEL: z.string().default(""),
    LLM_API_KEY: z.string().default(""),
    LLM_BASE_URL: optionalUrl,

    EMBEDDING_PROVIDER: z.enum(["disabled", "openai-compatible"]).default("disabled"),
    EMBEDDING_MODEL: z.string().default(""),
    EMBEDDING_API_KEY: z.string().default(""),
    EMBEDDING_BASE_URL: optionalUrl,
    EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(10_000),

    MEDIA_REALTIME_ENABLED: booleanFlag,
    MEDIA_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(2500),
    MEDIA_WORKER_SHARED_SECRET: z.string().default(""),
    MEDIA_TRANSPORT_PROVIDER: z.enum(["disabled", "livekit"]).default("disabled"),
    LIVEKIT_URL: optionalUrl,
    LIVEKIT_HEALTH_URL: optionalUrl,
    LIVEKIT_API_KEY: z.string().default(""),
    LIVEKIT_API_SECRET: z.string().default(""),
    LIVEKIT_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    TURN_URLS: z.string().default(""),
    VAD_PROVIDER: z.enum(["disabled", "silero-http"]).default("disabled"),
    VAD_BASE_URL: optionalUrl,
    STT_PROVIDER: z.enum(["disabled", "whisper-http"]).default("disabled"),
    STT_BASE_URL: optionalUrl,
    TTS_PROVIDER: z.enum(["disabled", "local-http"]).default("disabled"),
    TTS_BASE_URL: optionalUrl,
    AVATAR_PROVIDER: z.enum(["disabled", "musetalk-http"]).default("disabled"),
    AVATAR_BASE_URL: optionalUrl,
  })
  .superRefine((value, context) => {
    if (value.EMAIL_PROVIDER !== "disabled") {
      if (!value.EMAIL_FROM_ADDRESS || !emailAddress.safeParse(value.EMAIL_FROM_ADDRESS).success) {
        context.addIssue({
          code: "custom",
          path: ["EMAIL_FROM_ADDRESS"],
          message: "a valid sender address is required when email delivery is enabled",
        });
      }
      if (value.EMAIL_REPLY_TO && !emailAddress.safeParse(value.EMAIL_REPLY_TO).success) {
        context.addIssue({
          code: "custom",
          path: ["EMAIL_REPLY_TO"],
          message: "must be a valid email address when provided",
        });
      }
    }

    if (value.EMAIL_PROVIDER === "smtp") {
      if (!value.SMTP_HOST) {
        context.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "required when EMAIL_PROVIDER=smtp" });
      }
      const hasUsername = Boolean(value.SMTP_USERNAME);
      const hasPassword = Boolean(value.SMTP_PASSWORD);
      if (hasUsername !== hasPassword) {
        context.addIssue({
          code: "custom",
          path: ["SMTP_USERNAME"],
          message: "SMTP_USERNAME and SMTP_PASSWORD must be supplied together",
        });
      }
      if (value.NODE_ENV === "production" && !value.SMTP_SECURE && !value.SMTP_REQUIRE_TLS) {
        context.addIssue({
          code: "custom",
          path: ["SMTP_REQUIRE_TLS"],
          message: "production SMTP must use implicit TLS or require STARTTLS",
        });
      }
    }

    if (value.EMAIL_PROVIDER === "ses") {
      if (!value.SES_ACCESS_KEY_ID) {
        context.addIssue({ code: "custom", path: ["SES_ACCESS_KEY_ID"], message: "required when EMAIL_PROVIDER=ses" });
      }
      if (!value.SES_SECRET_ACCESS_KEY) {
        context.addIssue({ code: "custom", path: ["SES_SECRET_ACCESS_KEY"], message: "required when EMAIL_PROVIDER=ses" });
      }
    }

    if (value.EMAIL_PROVIDER === "sendgrid" && !value.SENDGRID_API_KEY) {
      context.addIssue({ code: "custom", path: ["SENDGRID_API_KEY"], message: "required when EMAIL_PROVIDER=sendgrid" });
    }

    if (value.LLM_PROVIDER === "openai-compatible") {
      if (!value.LLM_API_KEY) {
        context.addIssue({
          code: "custom",
          path: ["LLM_API_KEY"],
          message: "required when LLM_PROVIDER=openai-compatible",
        });
      }
      if (!value.LLM_MODEL) {
        context.addIssue({
          code: "custom",
          path: ["LLM_MODEL"],
          message: "required when LLM_PROVIDER=openai-compatible unless every call supplies a model",
        });
      }
    }

    if (value.EMBEDDING_PROVIDER === "openai-compatible") {
      if (!value.EMBEDDING_MODEL) {
        context.addIssue({
          code: "custom",
          path: ["EMBEDDING_MODEL"],
          message: "required when EMBEDDING_PROVIDER=openai-compatible",
        });
      }
      if (!value.EMBEDDING_API_KEY && !value.LLM_API_KEY) {
        context.addIssue({
          code: "custom",
          path: ["EMBEDDING_API_KEY"],
          message: "EMBEDDING_API_KEY or LLM_API_KEY is required when embeddings are enabled",
        });
      }
    }

    if (value.STORAGE_PROVIDER === "s3") {
      if (!value.S3_BUCKET) {
        context.addIssue({
          code: "custom",
          path: ["S3_BUCKET"],
          message: "required when STORAGE_PROVIDER=s3",
        });
      }
      const hasAccessKey = Boolean(value.S3_ACCESS_KEY_ID);
      const hasSecret = Boolean(value.S3_SECRET_ACCESS_KEY);
      if (hasAccessKey !== hasSecret) {
        context.addIssue({
          code: "custom",
          path: ["S3_ACCESS_KEY_ID"],
          message: "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be supplied together",
        });
      }
    }

    if (value.MEDIA_TRANSPORT_PROVIDER === "livekit") {
      const requiredLiveKitValues: Array<["LIVEKIT_URL" | "LIVEKIT_HEALTH_URL" | "LIVEKIT_API_KEY" | "LIVEKIT_API_SECRET", string | undefined]> = [
        ["LIVEKIT_URL", value.LIVEKIT_URL],
        ["LIVEKIT_HEALTH_URL", value.LIVEKIT_HEALTH_URL],
        ["LIVEKIT_API_KEY", value.LIVEKIT_API_KEY],
        ["LIVEKIT_API_SECRET", value.LIVEKIT_API_SECRET],
      ];
      for (const [field, configuredValue] of requiredLiveKitValues) {
        if (!configuredValue?.trim()) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `required when MEDIA_TRANSPORT_PROVIDER=livekit`,
          });
        }
      }

      const liveKitProtocol = urlProtocol(value.LIVEKIT_URL);
      if (value.LIVEKIT_URL && !["ws:", "wss:"].includes(liveKitProtocol ?? "")) {
        context.addIssue({
          code: "custom",
          path: ["LIVEKIT_URL"],
          message: "must use ws:// or wss://",
        });
      }
      const healthProtocol = urlProtocol(value.LIVEKIT_HEALTH_URL);
      if (value.LIVEKIT_HEALTH_URL && !["http:", "https:"].includes(healthProtocol ?? "")) {
        context.addIssue({
          code: "custom",
          path: ["LIVEKIT_HEALTH_URL"],
          message: "must use http:// or https://",
        });
      }

      if (value.NODE_ENV === "production") {
        if (liveKitProtocol !== "wss:") {
          context.addIssue({
            code: "custom",
            path: ["LIVEKIT_URL"],
            message: "production LiveKit transport must use wss://",
          });
        }
        if (healthProtocol !== "https:") {
          context.addIssue({
            code: "custom",
            path: ["LIVEKIT_HEALTH_URL"],
            message: "production LiveKit health checks must use https://",
          });
        }
        const normalizedSecret = value.LIVEKIT_API_SECRET.trim().toLowerCase();
        if (
          Buffer.byteLength(value.LIVEKIT_API_SECRET, "utf8") < 32 ||
          weakDeploymentSecrets.has(normalizedSecret)
        ) {
          context.addIssue({
            code: "custom",
            path: ["LIVEKIT_API_SECRET"],
            message: "production LiveKit API secret must be at least 32 bytes and not a placeholder",
          });
        }
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
        .join("; ");
      throw new Error(`Invalid environment configuration: ${details}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function resetEnvCacheForTests(): void {
  cached = undefined;
}
