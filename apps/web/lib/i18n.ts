export const supportedLocales = ["fa", "en"] as const;
export type AppLocale = (typeof supportedLocales)[number];

export function getDefaultLocale(): AppLocale {
  return process.env.NEXT_PUBLIC_DEFAULT_LOCALE === "fa" ? "fa" : "en";
}

export function directionFor(locale: AppLocale): "rtl" | "ltr" {
  return locale === "fa" ? "rtl" : "ltr";
}

export const shellCopy = {
  fa: {
    navigationLabel: "ناوبری اصلی",
    mobileNavigationLabel: "ناوبری موبایل",
    subtitle: "فضای کاری استخدام",
    navigation: [
      ["خانه", "/app"],
      ["موقعیت‌ها", "/app/jobs"],
      ["کاندیداها", "/app/candidates"],
      ["استعدادها", "/app/talent"],
      ["مصاحبه‌ها", "/app/interviews"],
      ["پیام‌ها", "/app/inbox"],
      ["تحلیل‌ها", "/app/analytics"],
      ["اتوماسیون", "/app/automations"],
      ["اتصال‌ها", "/app/integrations"],
      ["تنظیمات", "/app/settings"],
    ],
  },
  en: {
    navigationLabel: "Primary navigation",
    mobileNavigationLabel: "Mobile navigation",
    subtitle: "Recruiting workspace",
    navigation: [
      ["Home", "/app"],
      ["Jobs", "/app/jobs"],
      ["Candidates", "/app/candidates"],
      ["Talent", "/app/talent"],
      ["Interviews", "/app/interviews"],
      ["Inbox", "/app/inbox"],
      ["Analytics", "/app/analytics"],
      ["Automations", "/app/automations"],
      ["Integrations", "/app/integrations"],
      ["Settings", "/app/settings"],
    ],
  },
} as const;

export const foundationCopy = {
  fa: {
    commandTitle: "Command Center",
    commandDescription: "کارهای نیازمند توجه، فعالیت‌های AI و تصمیم‌های در انتظار بررسی در اینجا جمع می‌شوند.",
    attention: "نیازمند توجه",
    noData: "هنوز داده‌ای وجود ندارد",
    aiActivity: "فعالیت AI",
    aiReady: "Gateway آماده اتصال است",
    aiSuggestion: "پیشنهاد AI",
    firstJobTitle: "اولین موقعیت شغلی را ایجاد کنید",
    firstJobDescription: "Job Workspace در milestone بعدی به این shell متصل می‌شود.",
    candidateBrand: "Interview Platform · کاندیدا",
    candidateTitle: "پرتال کاندیدا",
    candidateDescription: "ورود واقعی این بخش از طریق invitation امن و session محدود انجام خواهد شد.",
    candidateSurfaceTitle: "تجربه‌ای جدا از پنل HR",
    candidateSurfaceDescription: "Consent، device check، screening، interview و assessment در این surface مستقل اجرا می‌شوند.",
    workspaceReady: "فضای کاری آماده است",
    workspaceDeferred: "داده و قابلیت‌های این بخش در vertical slice مربوط به خودش اضافه می‌شوند.",
  },
  en: {
    commandTitle: "Command Center",
    commandDescription: "Attention items, AI activity, and pending human decisions are collected here.",
    attention: "Needs attention",
    noData: "No data yet",
    aiActivity: "AI activity",
    aiReady: "Gateway is ready to connect",
    aiSuggestion: "AI suggestion",
    firstJobTitle: "Create the first job",
    firstJobDescription: "The Job Workspace is connected in the next product vertical slice.",
    candidateBrand: "Interview Platform · Candidate",
    candidateTitle: "Candidate portal",
    candidateDescription: "Real entry will use a secure invitation and limited candidate session.",
    candidateSurfaceTitle: "Separate from the HR workspace",
    candidateSurfaceDescription: "Consent, device check, screening, interview, and assessment run in this separate surface.",
    workspaceReady: "Workspace is ready",
    workspaceDeferred: "Data and capabilities are added with the relevant product vertical slice.",
  },
} as const;
