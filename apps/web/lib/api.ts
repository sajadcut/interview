import { createInterviewApiClient } from "@interview/api-client";

const directApiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4100";
const apiBaseUrl = typeof window === "undefined" ? directApiBaseUrl : "/api/backend";

export const api = createInterviewApiClient(apiBaseUrl);

export function apiError(result: unknown): unknown {
  if (result && typeof result === "object" && "error" in result) {
    return (result as { error?: unknown }).error;
  }
  return undefined;
}

function localizeApiMessage(message: string): string {
  return message
    .replace(/must be longer than or equal to (\d+) characters/gi, "باید حداقل $1 کاراکتر باشد")
    .replace(/must be shorter than or equal to (\d+) characters/gi, "باید حداکثر $1 کاراکتر باشد")
    .replace(/must be an email/gi, "باید یک ایمیل معتبر باشد")
    .replace(/should not be empty/gi, "نباید خالی باشد")
    .replace(/must be a UUID/gi, "باید شناسه معتبر UUID باشد")
    .replace(/Unauthorized/gi, "دسترسی احراز هویت نشده است")
    .replace(/Forbidden/gi, "اجازه انجام این عملیات را ندارید");
}

export function apiErrorMessage(result: unknown, fallback: string): string {
  const error = apiError(result);
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return localizeApiMessage(message);
    if (Array.isArray(message)) return message.map((item) => localizeApiMessage(String(item))).join("؛ ");
  }
  return fallback;
}
