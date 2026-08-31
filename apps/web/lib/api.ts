import { createInterviewApiClient } from "@interview/api-client";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const api = createInterviewApiClient(apiBaseUrl);
