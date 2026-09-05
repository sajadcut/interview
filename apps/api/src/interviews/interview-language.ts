export const InterviewSpokenLanguages = ["en", "fa"] as const;

export type InterviewSpokenLanguage = (typeof InterviewSpokenLanguages)[number];

export function normalizeInterviewSpokenLanguage(value: unknown): InterviewSpokenLanguage {
  if (typeof value !== "string") return "en";
  const normalized = value.trim().toLocaleLowerCase().replaceAll("_", "-");
  if (normalized === "fa" || normalized.startsWith("fa-") || normalized === "persian") return "fa";
  return "en";
}

export function containsPersianScript(value: string): boolean {
  return /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u.test(value);
}
