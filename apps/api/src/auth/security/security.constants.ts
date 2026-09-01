export const AUTH_SECURITY_POLICY = {
  maxFailedLoginAttempts: 5,
  sessionDurationMinutes: 60,
  refreshTokenRotationEnabled: true,
  auditAuthenticationEvents: true,
} as const;
