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

const booleanFlag = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_HOST: z.string().trim().min(1).default("127.0.0.1"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CORS_ORIGIN: z.string().trim().min(1).default("http://localhost:3000"),
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
