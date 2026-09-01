"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type UiPermission =
  | "organization.read"
  | "organization.manage"
  | "organization.manage_users"
  | "settings.manage"
  | "job.read"
  | "job.create"
  | "job.edit"
  | "candidate.read"
  | "candidate.contact"
  | "candidate.move_stage"
  | "candidate.score"
  | "sourcing.run"
  | "talent.manage"
  | "screening.manage"
  | "scheduling.manage"
  | "knowledge.manage"
  | "interview.read"
  | "interview.manage"
  | "interview.assign"
  | "interview.start"
  | "interview.evaluate"
  | "assessment.read"
  | "assessment.manage"
  | "analytics.read"
  | "privacy.manage"
  | "decision.submit"
  | "automation.manage"
  | "integration.manage"
  | "audit.read";

export interface InternalOrganization {
  id: string;
  name: string;
  slug: string;
  roles: string[];
}

interface InternalUser {
  id: string;
  displayName?: string;
  email?: string;
}

interface InternalAccessValue {
  loading: boolean;
  authenticated: boolean;
  developmentFallback: boolean;
  user?: InternalUser;
  organizations: InternalOrganization[];
  organization?: InternalOrganization;
  roles: string[];
  permissions: ReadonlySet<UiPermission>;
  can: (permission: UiPermission) => boolean;
  selectOrganization: (organizationId: string) => void;
}

const ALL_PERMISSIONS: UiPermission[] = [
  "organization.read",
  "organization.manage",
  "organization.manage_users",
  "settings.manage",
  "job.read",
  "job.create",
  "job.edit",
  "candidate.read",
  "candidate.contact",
  "candidate.move_stage",
  "candidate.score",
  "sourcing.run",
  "talent.manage",
  "screening.manage",
  "scheduling.manage",
  "knowledge.manage",
  "interview.read",
  "interview.manage",
  "interview.assign",
  "interview.start",
  "interview.evaluate",
  "assessment.read",
  "assessment.manage",
  "analytics.read",
  "privacy.manage",
  "decision.submit",
  "automation.manage",
  "integration.manage",
  "audit.read",
];

const ROLE_PERMISSIONS: Record<string, readonly UiPermission[]> = {
  PLATFORM_ADMIN: ALL_PERMISSIONS,
  ORGANIZATION_ADMIN: ALL_PERMISSIONS,
  org_admin: ALL_PERMISSIONS,
  HR_MANAGER: [
    "organization.read",
    "settings.manage",
    "job.read",
    "job.edit",
    "candidate.read",
    "candidate.contact",
    "candidate.move_stage",
    "candidate.score",
    "talent.manage",
    "screening.manage",
    "scheduling.manage",
    "knowledge.manage",
    "interview.read",
    "interview.assign",
    "interview.evaluate",
    "assessment.read",
    "analytics.read",
    "privacy.manage",
    "decision.submit",
    "automation.manage",
    "audit.read",
  ],
  RECRUITER: [
    "job.read",
    "job.create",
    "job.edit",
    "candidate.read",
    "candidate.contact",
    "candidate.move_stage",
    "candidate.score",
    "sourcing.run",
    "talent.manage",
    "screening.manage",
    "scheduling.manage",
    "knowledge.manage",
    "interview.read",
    "interview.manage",
    "interview.assign",
    "interview.start",
    "assessment.read",
    "assessment.manage",
    "automation.manage",
  ],
  INTERVIEWER: [
    "candidate.read",
    "candidate.score",
    "interview.read",
    "interview.start",
    "interview.evaluate",
    "assessment.read",
  ],
  HIRING_MANAGER: [
    "organization.read",
    "job.read",
    "candidate.read",
    "candidate.score",
    "interview.read",
    "interview.evaluate",
    "assessment.read",
    "analytics.read",
    "decision.submit",
  ],
};

const STORAGE_KEY = "interview.organizationId";
const AccessContext = createContext<InternalAccessValue | null>(null);

function permissionsFor(roles: string[]): ReadonlySet<UiPermission> {
  const permissions = new Set<UiPermission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) permissions.add(permission);
  }
  return permissions;
}

function permissionForPath(pathname: string): UiPermission | undefined {
  if (pathname.startsWith("/app/settings/users")) return "organization.manage_users";
  if (pathname.startsWith("/app/integrations")) return "integration.manage";
  if (pathname.startsWith("/app/automations")) return "automation.manage";
  if (pathname.startsWith("/app/analytics")) return "analytics.read";
  if (pathname.startsWith("/app/inbox")) return "candidate.contact";
  if (pathname.startsWith("/app/interviews")) return "interview.read";
  if (pathname.startsWith("/app/talent")) return "candidate.read";
  if (pathname.startsWith("/app/candidates")) return "candidate.read";
  if (pathname.startsWith("/app/jobs")) return "job.read";
  if (pathname.startsWith("/app/settings")) return "organization.read";
  return undefined;
}

export function requiredPermissionForInternalPath(pathname: string): UiPermission | undefined {
  return permissionForPath(pathname);
}

export function InternalAccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [developmentFallback, setDevelopmentFallback] = useState(false);
  const [user, setUser] = useState<InternalUser>();
  const [organizations, setOrganizations] = useState<InternalOrganization[]>([]);
  const [organizationId, setOrganizationId] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const sessionResponse = await fetch("/api/backend/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (sessionResponse.ok) {
          const session = (await sessionResponse.json()) as {
            userId?: string;
            user?: InternalUser;
            organizations?: InternalOrganization[];
          };
          const available = session.organizations ?? [];
          const stored = window.localStorage.getItem(STORAGE_KEY) ?? undefined;
          const selected =
            (stored && available.some((organization) => organization.id === stored)
              ? stored
              : undefined) ?? available[0]?.id;
          if (active) {
            setAuthenticated(true);
            setUser(session.user ?? (session.userId ? { id: session.userId } : undefined));
            setOrganizations(available);
            setOrganizationId(selected);
            setDevelopmentFallback(false);
            if (selected) window.localStorage.setItem(STORAGE_KEY, selected);
          }
          return;
        }

        if (process.env.NODE_ENV !== "production") {
          const developmentResponse = await fetch("/api/backend/development/context", {
            cache: "no-store",
          });
          if (developmentResponse.ok) {
            const context = (await developmentResponse.json()) as {
              ready?: boolean;
              organizationId?: string;
              userId?: string;
            };
            if (context.ready && context.organizationId && context.userId && active) {
              const developmentOrganization: InternalOrganization = {
                id: context.organizationId,
                name: "Development Organization",
                slug: "development",
                roles: ["ORGANIZATION_ADMIN"],
              };
              setAuthenticated(true);
              setDevelopmentFallback(true);
              setUser({ id: context.userId, displayName: "Development Admin" });
              setOrganizations([developmentOrganization]);
              setOrganizationId(context.organizationId);
              window.localStorage.setItem(STORAGE_KEY, context.organizationId);
              return;
            }
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const organization = organizations.find((item) => item.id === organizationId) ?? organizations[0];
  const roles = organization?.roles ?? [];
  const permissions = useMemo(() => permissionsFor(roles), [roles]);
  const can = (permission: UiPermission) => permissions.has(permission);
  const selectOrganization = (nextOrganizationId: string) => {
    if (!organizations.some((item) => item.id === nextOrganizationId)) return;
    window.localStorage.setItem(STORAGE_KEY, nextOrganizationId);
    setOrganizationId(nextOrganizationId);
  };

  const value: InternalAccessValue = {
    loading,
    authenticated,
    developmentFallback,
    ...(user ? { user } : {}),
    organizations,
    ...(organization ? { organization } : {}),
    roles,
    permissions,
    can,
    selectOrganization,
  };

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500">
        در حال بررسی دسترسی…
      </div>
    );
  }

  if (!authenticated || !organization) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">ورود سازمانی لازم است</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            برای دسترسی به پنل داخلی، ابتدا وارد حساب سازمانی شوید.
          </p>
          <Link
            href="/login"
            className="mt-5 inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
          >
            ورود
          </Link>
        </div>
      </div>
    );
  }

  const required = permissionForPath(pathname);
  if (required && !can(required)) {
    return (
      <AccessContext.Provider value={value}>
        <div className="grid min-h-screen place-items-center bg-slate-50 p-6">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-600">
              Access denied
            </div>
            <h1 className="mt-2 text-xl font-semibold text-slate-900">
              این بخش برای نقش فعلی شما مجاز نیست
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              مجوز لازم: <code>{required}</code>. کنترل سمت سرور همچنان مرجع امنیتی نهایی است.
            </p>
            <Link
              href="/app"
              className="mt-5 inline-flex rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
            >
              بازگشت به خانه
            </Link>
          </div>
        </div>
      </AccessContext.Provider>
    );
  }

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useInternalAccess(): InternalAccessValue {
  const value = useContext(AccessContext);
  if (!value) throw new Error("useInternalAccess must be used inside InternalAccessGate");
  return value;
}

export function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission: UiPermission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const access = useInternalAccess();
  return access.can(permission) ? <>{children}</> : <>{fallback}</>;
}
