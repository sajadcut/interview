export interface SessionContext {
  userId: string;
  organizationId?: string;
  sessionId: string;
  roles: string[];
}
