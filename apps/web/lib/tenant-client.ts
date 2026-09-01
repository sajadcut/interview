export interface SessionOrganization {
  id: string;
  name: string;
  slug: string;
  roles: string[];
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

export async function resolveOrganizationId(): Promise<string> {
  const stored = storedOrganizationId();
  if (stored) return stored;

  const sessionResponse = await fetch("/api/backend/auth/session", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (sessionResponse.ok) {
    const session = (await sessionResponse.json()) as { organizations?: SessionOrganization[] };
    const organizationId = session.organizations?.[0]?.id;
    if (organizationId) {
      rememberOrganizationId(organizationId);
      return organizationId;
    }
  }

  const developmentResponse = await fetch("/api/backend/development/context", { cache: "no-store" });
  if (developmentResponse.ok) {
    const context = (await developmentResponse.json()) as { organizationId?: string };
    if (context.organizationId) {
      rememberOrganizationId(context.organizationId);
      return context.organizationId;
    }
  }

  throw new Error("No active organization is available for this session");
}

export function tenantHeaders(organizationId: string, json = false): HeadersInit {
  return {
    "x-organization-id": organizationId,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}
