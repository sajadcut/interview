export const SESSION_POLICY = {
  COOKIE_NAME: 'interview_session',
  REFRESH_COOKIE_NAME: 'interview_refresh',
  internalUserDays: 7,
  candidateHours: 24,
  refreshTokenDays: 30,
  cookie: {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
  },
} as const;

export function sessionMaxAgeMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}
