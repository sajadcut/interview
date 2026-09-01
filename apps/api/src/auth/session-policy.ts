export const SESSION_POLICY = {
  internalUserDays: 7,
  candidateHours: 24,
  refreshTokenDays: 30,
  cookie: {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  },
} as const;
