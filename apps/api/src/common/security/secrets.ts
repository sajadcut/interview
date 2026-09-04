import { createHash, timingSafeEqual } from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";

export const INTERNAL_SHARED_SECRET_NAMES = [
  "AI_WORKER_SHARED_SECRET",
  "ASSESSMENT_WORKER_SHARED_SECRET",
  "PRIVACY_WORKER_SHARED_SECRET",
  "RETENTION_WORKER_SHARED_SECRET",
  "MEDIA_WORKER_SHARED_SECRET",
] as const;

export type InternalSharedSecretName = (typeof INTERNAL_SHARED_SECRET_NAMES)[number];

const PRODUCTION_SECRET_NAMES = [
  ...INTERNAL_SHARED_SECRET_NAMES,
  "SMTP_PASSWORD",
  "SES_SECRET_ACCESS_KEY",
  "SENDGRID_API_KEY",
  "GOOGLE_CALENDAR_PRIVATE_KEY",
  "MICROSOFT_CALENDAR_CLIENT_SECRET",
  "LLM_API_KEY",
  "EMBEDDING_API_KEY",
  "S3_SECRET_ACCESS_KEY",
  "LIVEKIT_API_SECRET",
] as const;

const DEVELOPMENT_DATABASE_URL = "postgresql://interview:interview@localhost:5432/interview";
const PLACEHOLDER_SECRET = /^(?:change-?me|changeme|replace-?me|password|secret|example|sample|dummy|development|local|test)$/i;

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) return true;
  }
  return false;
}

export function sharedSecretIssue(
  rawValue: string | undefined,
  nodeEnv = process.env.NODE_ENV,
): string | undefined {
  const value = rawValue?.trim() ?? "";
  if (!value) return "is not configured";
  if (containsControlCharacter(value)) return "contains control characters";
  const minimumBytes = nodeEnv === "production" ? 32 : 8;
  if (Buffer.byteLength(value, "utf8") < minimumBytes) {
    return `must be at least ${minimumBytes} UTF-8 bytes`;
  }
  if (nodeEnv === "production" && PLACEHOLDER_SECRET.test(value)) {
    return "uses a placeholder value";
  }
  return undefined;
}

export function requireSharedSecret(name: InternalSharedSecretName): string {
  const value = process.env[name]?.trim() ?? "";
  const issue = sharedSecretIssue(value);
  if (issue) {
    throw new ServiceUnavailableException(`${name} ${issue}; the worker API is disabled`);
  }
  return value;
}

export function constantTimeSecretMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export function assertProductionSecretPolicy(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.NODE_ENV !== "production") return;

  const databaseUrl = environment.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    throw new Error("Invalid production secret configuration: DATABASE_URL must be explicitly configured");
  }
  if (databaseUrl === DEVELOPMENT_DATABASE_URL) {
    throw new Error(
      "Invalid production secret configuration: DATABASE_URL must not use the development default credential",
    );
  }

  for (const name of INTERNAL_SHARED_SECRET_NAMES) {
    const value = environment[name]?.trim();
    if (!value) continue;
    const issue = sharedSecretIssue(value, "production");
    if (issue) throw new Error(`Invalid production secret configuration: ${name} ${issue}`);
  }

  for (const name of PRODUCTION_SECRET_NAMES) {
    const value = environment[name]?.trim();
    if (value && PLACEHOLDER_SECRET.test(value)) {
      throw new Error(`Invalid production secret configuration: ${name} uses a placeholder value`);
    }
  }

  if (environment.MEDIA_REALTIME_ENABLED === "true") {
    const mediaIssue = sharedSecretIssue(environment.MEDIA_WORKER_SHARED_SECRET, "production");
    if (mediaIssue) {
      throw new Error(
        `Invalid production secret configuration: MEDIA_WORKER_SHARED_SECRET ${mediaIssue} while realtime media is enabled`,
      );
    }
  }
}
