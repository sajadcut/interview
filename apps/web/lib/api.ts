import { createInterviewApiClient } from "@interview/api-client";

const directApiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4100";
const apiBaseUrl = typeof window === "undefined" ? directApiBaseUrl : "/api/backend";

export const api = createInterviewApiClient(apiBaseUrl);
