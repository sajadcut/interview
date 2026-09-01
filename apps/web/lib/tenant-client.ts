export interface SessionOrganization {
  id: string;
  name: string;
  slug: string;
  roles: string[];
}

export interface TenantIdentity {
  organizationId: string;
  developmentUserId?: string;
}

const ORGANIZATION_STORAGE_KEY = "interview.organizationId";

function storedOrganizationId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ORGANIZATION_STORAGE_KEY);
}

export function rememberOrganizationId(organizationId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, organizationId);
}

export async function resolveTenantIdentity(): Promise<TenantIdentity> {
  const stored = storedOrganizationId();
  const sessionResponse = await fetch("/api/backend/auth/session", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (sessionResponse.ok) {
    const session = (await sessionResponse.json()) as { organizations?: SessionOrganization[] };
    const organizations = session.organizations ?? [];
    const organizationId =
      (stored && organizations.some((organization) => organization.id === stored) ? stored : undefined) ??
      organizations[0]?.id;
    if (organizationId) {
      rememberOrganizationId(organizationId);
      return { organizationId };
    }
  }

  const developmentResponse = await fetch("/api/backend/development/context", { cache: "no-store" });
  if (developmentResponse.ok) {
    const context = (await developmentResponse.json()) as {
      organizationId?: string;
      userId?: string;
    };
    if (context.organizationId && context.userId) {
      rememberOrganizationId(context.organizationId);
      return {
        organizationId: context.organizationId,
        developmentUserId: context.userId,
      };
    }
  }

  throw new Error("No active organization is available for this session");
}

export async function resolveOrganizationId(): Promise<string> {
  return (await resolveTenantIdentity()).organizationId;
}

export function tenantHeaders(identity: TenantIdentity, json = false): HeadersInit {
  return {
    "x-organization-id": identity.organizationId,
    ...(identity.developmentUserId ? { "x-user-id": identity.developmentUserId } : {}),
    ...(json ? { "content-type": "application/json" } : {}),
  };
}
