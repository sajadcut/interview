export interface SessionCookieNames {
  session: string;
  refresh: string;
}

export function sessionCookieNames(nodeEnv = process.env.NODE_ENV): SessionCookieNames {
  if (nodeEnv === "production") {
    return {
      session: "__Host-interview_session",
      refresh: "__Secure-interview_refresh",
    };
  }
  return {
    session: "interview_session",
    refresh: "interview_refresh",
  };
}

const cookieNames = sessionCookieNames();

export const SESSION_POLICY = {
  COOKIE_NAME: cookieNames.session,
  REFRESH_COOKIE_NAME: cookieNames.refresh,
  internalUserDays: 7,
  candidateHours: 24,
  refreshTokenDays: 30,
  cookie: {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    priority: "high" as const,
  },
} as const;

export function sessionMaxAgeMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}
