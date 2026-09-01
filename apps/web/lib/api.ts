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

export function apiErrorMessage(result: unknown, fallback: string): string {
  const error = apiError(result);
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.map(String).join("; ");
  }
  return fallback;
}
