export const SUPPORTED_RETENTION_ENTITY_TYPES = [
  "candidates",
  "ai_executions",
  "recruitment_events",
  "interview_media_events",
] as const;

export type SupportedRetentionEntityType =
  (typeof SUPPORTED_RETENTION_ENTITY_TYPES)[number];

const supported = new Set<string>(SUPPORTED_RETENTION_ENTITY_TYPES);

export function isSupportedRetentionEntityType(
  value: string,
): value is SupportedRetentionEntityType {
  return supported.has(value);
}
