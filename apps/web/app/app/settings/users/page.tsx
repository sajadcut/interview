"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  resolveTenantIdentity,
  tenantHeaders,
  type TenantIdentity,
} from "../../../../lib/tenant-client";

const ROLES = [
  "ORGANIZATION_ADMIN",
  "RECRUITER",
  "INTERVIEWER",
  "HIRING_MANAGER",
] as const;

type Role = (typeof ROLES)[number];

type OrganizationUser = {
  userId: string;
  membershipId: string;
  email: string;
  displayName?: string;
  status: string;
  roles: string[];
  lastLoginAt?: string;
};

type Invitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  deliveryRequired: boolean;
  developmentToken?: string;
};

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.map(String).join("; ");
  }
  return fallback;
}

export default function OrganizationUsersPage() {
  const [identity, setIdentity] = useState<TenantIdentity | null>(null);
  const [users, setUsers] = useState<OrganizationUser[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("RECRUITER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [developmentToken, setDevelopmentToken] = useState<string | null>(null);

  const load = useCallback(async (resolvedIdentity?: TenantIdentity) => {
    const currentIdentity = resolvedIdentity ?? identity ?? (await resolveTenantIdentity());
    setIdentity(currentIdentity);
    const headers = tenantHeaders(currentIdentity);
    const [usersResponse, invitationsResponse] = await Promise.all([
      fetch("/api/backend/v1/organization/users", { cache: "no-store", headers }),
      fetch("/api/backend/v1/organization/users/invitations", { cache: "no-store", headers }),
    ]);
    if (!usersResponse.ok) {
      throw new Error(errorMessage(await usersResponse.json().catch(() => null), "Unable to load organization users"));
    }
    if (!invitationsResponse.ok) {
      throw new Error(errorMessage(await invitationsResponse.json().catch(() => null), "Unable to load invitations"));
    }
    setUsers((await usersResponse.json()) as OrganizationUser[]);
    setInvitations((await invitationsResponse.json()) as Invitation[]);
  }, [identity]);

  useEffect(() => {
    resolveTenantIdentity()
      .then((resolved) => load(resolved))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load organization access"));
  }, [load]);

  async function request(path: string, init: RequestInit) {
    const currentIdentity = identity ?? (await resolveTenantIdentity());
    setIdentity(currentIdentity);
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        ...tenantHeaders(currentIdentity, init.body !== undefined),
        ...init.headers,
      },
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorMessage(payload, `Request failed with ${response.status}`));
    return payload;
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDevelopmentToken(null);
    try {
      const invitation = (await request("/api/backend/v1/organization/users/invitations", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      })) as Invitation;
      setEmail("");
      if (invitation.developmentToken) setDevelopmentToken(invitation.developmentToken);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to invite user");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, nextRole: Role) {
    setError(null);
    try {
      await request(`/api/backend/v1/organization/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to change role");
    }
  }

  async function changeStatus(user: OrganizationUser) {
    setError(null);
    try {
      await request(`/api/backend/v1/organization/users/${user.userId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: user.status === "active" ? "disabled" : "active" }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to change status");
    }
  }

  async function remove(userId: string) {
    if (!window.confirm("Remove this user from the organization? Their global account will not be deleted.")) return;
    setError(null);
    try {
      await request(`/api/backend/v1/organization/users/${userId}`, { method: "DELETE" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to remove user");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-indigo-600">Settings / Access</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-.03em] text-slate-950">Organization users</h1>
        <p className="mt-1 text-xs text-slate-500">Invite internal users, assign one operating role, disable access, or remove organization membership.</p>
      </div>

      {error ? <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div> : null}
      {developmentToken ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <div className="font-semibold">Development-only invitation token</div>
          <div className="mt-1 break-all font-mono text-[10px]">{developmentToken}</div>
          <div className="mt-1 text-[10px] text-amber-700">This value is never returned in production and must not be logged or committed.</div>
        </div>
      ) : null}

      <form onSubmit={invite} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-[1fr_220px_auto] md:items-end">
        <label className="text-xs font-medium text-slate-700">
          Email
          <input
            className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Role
          <select
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            {ROLES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        <button disabled={busy} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" type="submit">
          {busy ? "Creating…" : "Invite user"}
        </button>
      </form>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Members</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-[.06em] text-slate-400">
              <tr><th className="px-5 py-3">User</th><th className="px-3 py-3">Role</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Last login</th><th className="px-5 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => {
                const currentRole = ROLES.find((item) => user.roles.includes(item)) ?? "RECRUITER";
                return (
                  <tr key={user.userId}>
                    <td className="px-5 py-4"><div className="font-semibold text-slate-800">{user.displayName || user.email}</div><div className="mt-0.5 text-[10px] text-slate-500">{user.email}</div></td>
                    <td className="px-3 py-4">
                      <select className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px]" value={currentRole} onChange={(event) => changeRole(user.userId, event.target.value as Role)}>
                        {ROLES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-4"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${user.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{user.status}</span></td>
                    <td className="px-3 py-4 text-[11px] text-slate-500">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</td>
                    <td className="px-5 py-4 text-right">
                      <button className="mr-2 text-[11px] font-semibold text-indigo-600" type="button" onClick={() => changeStatus(user)}>{user.status === "active" ? "Disable" : "Reactivate"}</button>
                      <button className="text-[11px] font-semibold text-red-600" type="button" onClick={() => remove(user.userId)}>Remove</button>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 ? <tr><td className="px-5 py-8 text-center text-slate-400" colSpan={5}>No organization users found.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Pending invitations</h2>
        <div className="mt-3 space-y-2">
          {invitations.map((invitation) => (
            <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-3 text-xs">
              <div><div className="font-semibold text-slate-800">{invitation.email}</div><div className="mt-0.5 text-[10px] text-slate-500">{invitation.role.replaceAll("_", " ")} · expires {new Date(invitation.expiresAt).toLocaleString()}</div></div>
              <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">Delivery pending</span>
            </div>
          ))}
          {invitations.length === 0 ? <p className="text-xs text-slate-400">No pending invitations.</p> : null}
        </div>
      </section>
    </div>
  );
}
