export const SESSION_POLICY = {
  maxAgeSeconds: 604800,
  refreshTokenRotation: true,
  revokeOnLogout: true,
  httpOnlyCookie: true,
  sameSite: 'strict' as const,
  secureInProduction: true,
} as const;

export type SessionPolicy = typeof SESSION_POLICY;
