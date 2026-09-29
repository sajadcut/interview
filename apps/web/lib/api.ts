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

export function localizeApiMessage(message: string): string {
  return message
    .replace(/must be longer than or equal to (\d+) characters/gi, "باید حداقل $1 کاراکتر باشد")
    .replace(/must be shorter than or equal to (\d+) characters/gi, "باید حداکثر $1 کاراکتر باشد")
    .replace(/must be an email/gi, "باید یک ایمیل معتبر باشد")
    .replace(/should not be empty/gi, "نباید خالی باشد")
    .replace(/must be a UUID/gi, "باید شناسه معتبر UUID باشد")
    .replace(/Unauthorized/gi, "دسترسی احراز هویت نشده است")
    .replace(/Forbidden/gi, "اجازه انجام این عملیات را ندارید")
    .replace(/Invalid credentials/gi, "ایمیل یا رمز عبور نادرست است")
    .replace(/Invalid email or password/gi, "ایمیل یا رمز عبور نادرست است")
    .replace(/Authentication is required/gi, "برای ادامه باید وارد حساب شوید")
    .replace(/Account is disabled/gi, "حساب کاربری غیرفعال است")
    .replace(/User is disabled/gi, "حساب کاربری غیرفعال است")
    .replace(/Password reset failed/gi, "بازیابی رمز عبور ناموفق بود")
    .replace(/Invitation is invalid, expired, or already used/gi, "دعوت‌نامه نامعتبر، منقضی یا قبلاً استفاده شده است")
    .replace(/Invitation token is missing/gi, "توکن دعوت‌نامه وجود ندارد")
    .replace(/Candidate invitation is invalid or expired/gi, "دعوت‌نامه کاندیدا نامعتبر یا منقضی شده است")
    .replace(/Candidate invitation is invalid/gi, "دعوت‌نامه کاندیدا نامعتبر است")
    .replace(/Candidate invitation has already been used/gi, "دعوت‌نامه کاندیدا قبلاً استفاده شده است")
    .replace(/Candidate invitation has expired/gi, "دعوت‌نامه کاندیدا منقضی شده است")
    .replace(/Candidate invitation is temporarily locked/gi, "دعوت‌نامه کاندیدا موقتاً قفل شده است")
    .replace(/Candidate OTP challenge was not found/gi, "درخواست کد یک‌بارمصرف پیدا نشد")
    .replace(/Candidate OTP challenge has expired/gi, "کد یک‌بارمصرف منقضی شده است")
    .replace(/Candidate OTP challenge is locked/gi, "کد یک‌بارمصرف به‌دلیل تلاش‌های ناموفق قفل شده است")
    .replace(/Candidate OTP is invalid/gi, "کد یک‌بارمصرف نامعتبر است");
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
