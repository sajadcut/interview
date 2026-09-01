export const AUTH_RATE_LIMIT = {
  maxAttempts: 5,
  windowSeconds: 900,
  lockMinutes: 30,
} as const;
