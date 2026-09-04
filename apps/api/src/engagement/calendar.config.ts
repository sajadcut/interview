import { z } from "zod";
import { getEnv } from "../config/env";

// Ensure the repository's normal root .env loading/validation has run first.
void getEnv();

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);
const booleanFlag = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const calendarEnvSchema = z
  .object({
    CALENDAR_PROVIDER: z.enum(["disabled", "google", "microsoft"]).default("disabled"),
    CALENDAR_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
    CALENDAR_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
    CALENDAR_RETRY_BASE_MS: z.coerce.number().int().min(50).max(5_000).default(250),

    GOOGLE_CALENDAR_ID: z.string().trim().default(""),
    GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: z.string().trim().default(""),
    GOOGLE_CALENDAR_PRIVATE_KEY: z.string().default(""),
    GOOGLE_CALENDAR_DELEGATED_SUBJECT: z.string().trim().default(""),
    GOOGLE_CALENDAR_TOKEN_URL: optionalUrl,
    GOOGLE_CALENDAR_API_BASE_URL: optionalUrl,
    GOOGLE_CALENDAR_SEND_UPDATES: z.enum(["all", "externalOnly", "none"]).default("all"),
    GOOGLE_CALENDAR_CREATE_MEET: booleanFlag,

    MICROSOFT_CALENDAR_TENANT_ID: z.string().trim().default(""),
    MICROSOFT_CALENDAR_CLIENT_ID: z.string().trim().default(""),
    MICROSOFT_CALENDAR_CLIENT_SECRET: z.string().default(""),
    MICROSOFT_CALENDAR_USER_ID: z.string().trim().default(""),
    MICROSOFT_CALENDAR_ID: z.string().trim().default(""),
    MICROSOFT_CALENDAR_TOKEN_URL: optionalUrl,
    MICROSOFT_CALENDAR_GRAPH_BASE_URL: optionalUrl,
    MICROSOFT_CALENDAR_CREATE_TEAMS_MEETING: booleanFlag,
  })
  .superRefine((value, context) => {
    if (value.CALENDAR_PROVIDER === "google") {
      if (!value.GOOGLE_CALENDAR_ID) {
        context.addIssue({ code: "custom", path: ["GOOGLE_CALENDAR_ID"], message: "required when CALENDAR_PROVIDER=google" });
      }
      if (!value.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL || !z.string().email().safeParse(value.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL).success) {
        context.addIssue({
          code: "custom",
          path: ["GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL"],
          message: "a valid service-account email is required when CALENDAR_PROVIDER=google",
        });
      }
      if (!value.GOOGLE_CALENDAR_PRIVATE_KEY.includes("PRIVATE KEY")) {
        context.addIssue({
          code: "custom",
          path: ["GOOGLE_CALENDAR_PRIVATE_KEY"],
          message: "a PEM private key is required when CALENDAR_PROVIDER=google",
        });
      }
      if (
        value.GOOGLE_CALENDAR_DELEGATED_SUBJECT
        && !z.string().email().safeParse(value.GOOGLE_CALENDAR_DELEGATED_SUBJECT).success
      ) {
        context.addIssue({
          code: "custom",
          path: ["GOOGLE_CALENDAR_DELEGATED_SUBJECT"],
          message: "must be a valid email address when provided",
        });
      }
    }

    if (value.CALENDAR_PROVIDER === "microsoft") {
      for (const [field, current] of [
        ["MICROSOFT_CALENDAR_TENANT_ID", value.MICROSOFT_CALENDAR_TENANT_ID],
        ["MICROSOFT_CALENDAR_CLIENT_ID", value.MICROSOFT_CALENDAR_CLIENT_ID],
        ["MICROSOFT_CALENDAR_CLIENT_SECRET", value.MICROSOFT_CALENDAR_CLIENT_SECRET],
        ["MICROSOFT_CALENDAR_USER_ID", value.MICROSOFT_CALENDAR_USER_ID],
      ] as const) {
        if (!current) context.addIssue({ code: "custom", path: [field], message: `required when CALENDAR_PROVIDER=microsoft` });
      }
    }
  });

export type CalendarEnv = z.infer<typeof calendarEnvSchema>;

let cached: CalendarEnv | undefined;

export function getCalendarEnv(): CalendarEnv {
  if (!cached) {
    const parsed = calendarEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "calendar environment"}: ${issue.message}`)
        .join("; ");
      throw new Error(`Invalid calendar configuration: ${details}`);
    }
    cached = parsed.data;
  }
  return cached;
}
