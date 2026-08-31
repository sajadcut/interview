import createClient from "openapi-fetch";
import type { paths } from "./generated/schema";

export function createInterviewApiClient(baseUrl: string) {
  return createClient<paths>({ baseUrl: baseUrl.replace(/\/$/, "") });
}

export type InterviewApiClient = ReturnType<typeof createInterviewApiClient>;
