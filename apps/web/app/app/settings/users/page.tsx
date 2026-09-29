"use client";

import type { components } from "@interview/api-client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, localizeApiMessage } from "../../../../lib/api";
import { faDomainLabel, faRoleLabel, formatFaDateTime } from "../../../../lib/i18n";
import {
  resolveTenantIdentity,
  tenantHeaders,
  type TenantIdentity,
} from "../../../../lib/tenant-client";

const ROLES = [
  "ORGANIZATION_ADMIN",
  "HR_MANAGER",
  "RECRUITER",
  "INTERVIEWER",
  "HIRING_MANAGER",
] as const;

type Role = (typeof ROLES)[number];
type OrganizationUser = components["schemas"]["OrganizationUserDto"];
type Invitation = components["schemas"]["OrganizationInvitationDto"];

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string") return localizeApiMessage(message);
    if (Array.isArray(message)) return message.map((item) => localizeApiMessage(String(item))).join("؛ ");
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [developmentToken, setDevelopmentToken] = useState<string | null>(null);

  const load = useCallback(async (currentIdentity: TenantIdentity) => {
    const headers = tenantHeaders(currentIdentity);
    const [usersResult, invitationsResult] = await Promise.all([
      api.GET("/v1/organization/users", { headers }),
      api.GET("/v1/organization/users/invitations", { headers }),
    ]);
    if (usersResult.error || !usersResult.data) {
      throw new Error(errorMessage(usersResult.error, "کاربران سازمان بارگذاری نشدند"));
    }
    if (invitationsResult.error || !invitationsResult.data) {
      throw new Error(errorMessage(invitationsResult.error, "دعوت‌نامه‌ها بارگذاری نشدند"));
    }
    setUsers(usersResult.data);
    setInvitations(invitationsResult.data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void resolveTenantIdentity()
      .then(async (resolved) => {
        if (cancelled) return;
        setIdentity(resolved);
        await load(resolved);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "اطلاعات دسترسی سازمان بارگذاری نشد");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function currentIdentity(): Promise<TenantIdentity> {
    if (identity) return identity;
    const resolved = await resolveTenantIdentity();
    setIdentity(resolved);
    return resolved;
  }

  async function reload(): Promise<void> {
    await load(await currentIdentity());
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDevelopmentToken(null);
    try {
      const resolved = await currentIdentity();
      const result = await api.POST("/v1/organization/users/invitations", {
        headers: tenantHeaders(resolved),
        body: { email, role },
      });
      if (result.error || !result.data) throw new Error(errorMessage(result.error, "دعوت کاربر ناموفق بود"));
      setEmail("");
      if (result.data.developmentToken) setDevelopmentToken(result.data.developmentToken);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "دعوت کاربر ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, nextRole: Role) {
    setError(null);
    try {
      const resolved = await currentIdentity();
      const result = await api.PATCH("/v1/organization/users/{userId}/role", {
        params: { path: { userId } },
        headers: tenantHeaders(resolved),
        body: { role: nextRole },
      });
      if (result.error) throw new Error(errorMessage(result.error, "تغییر نقش ناموفق بود"));
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تغییر نقش ناموفق بود");
    }
  }

  async function changeStatus(user: OrganizationUser) {
    setError(null);
    try {
      const resolved = await currentIdentity();
      const result = await api.PATCH("/v1/organization/users/{userId}/status", {
        params: { path: { userId: user.userId } },
        headers: tenantHeaders(resolved),
        body: { status: user.status === "active" ? "disabled" : "active" },
      });
      if (result.error) throw new Error(errorMessage(result.error, "تغییر وضعیت کاربر ناموفق بود"));
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تغییر وضعیت کاربر ناموفق بود");
    }
  }

  async function remove(userId: string) {
    if (!window.confirm("این کاربر از سازمان حذف شود؟ حساب سراسری او حذف نخواهد شد.")) return;
    setError(null);
    try {
      const resolved = await currentIdentity();
      const result = await api.DELETE("/v1/organization/users/{userId}", {
        params: { path: { userId } },
        headers: tenantHeaders(resolved),
      });
      if (result.error) throw new Error(errorMessage(result.error, "حذف کاربر از سازمان ناموفق بود"));
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "حذف کاربر از سازمان ناموفق بود");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-indigo-600">تنظیمات / دسترسی</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-.03em] text-slate-950">کاربران سازمان</h1>
        <p className="mt-1 text-xs text-slate-500">کاربران داخلی را دعوت کنید، نقش عملیاتی تعیین کنید، دسترسی را غیرفعال کنید یا عضویت سازمان را حذف کنید.</p>
      </div>

      {error ? <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div> : null}
      {developmentToken ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <div className="font-semibold">توکن دعوت مخصوص محیط توسعه</div>
          <div className="mt-1 break-all font-mono text-[10px]">{developmentToken}</div>
          <div className="mt-1 text-[10px] text-amber-700">این مقدار در محیط تولید بازگردانده نمی‌شود و نباید در لاگ یا مخزن ثبت شود.</div>
        </div>
      ) : null}

      <form onSubmit={invite} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-[1fr_220px_auto] md:items-end">
        <label className="text-xs font-medium text-slate-700">
          ایمیل
          <input className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="text-xs font-medium text-slate-700">
          نقش
          <select className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" value={role} onChange={(event) => setRole(event.target.value as Role)}>
            {ROLES.map((item) => <option key={item} value={item}>{faRoleLabel(item)}</option>)}
          </select>
        </label>
        <button disabled={busy} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" type="submit">{busy ? "در حال ایجاد…" : "دعوت کاربر"}</button>
      </form>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold text-slate-900">اعضای سازمان</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-start text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-[.06em] text-slate-400"><tr><th className="px-5 py-3">کاربر</th><th className="px-3 py-3">نقش</th><th className="px-3 py-3">وضعیت</th><th className="px-3 py-3">آخرین ورود</th><th className="px-5 py-3 text-end">اقدامات</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td className="px-5 py-8 text-center text-slate-400" colSpan={5}>در حال بارگذاری اعضای سازمان…</td></tr> : users.map((user) => {
                const currentRole = ROLES.find((item) => user.roles.includes(item)) ?? "RECRUITER";
                return <tr key={user.userId}>
                  <td className="px-5 py-4"><div className="font-semibold text-slate-800">{user.displayName || user.email}</div><div className="mt-0.5 text-[10px] text-slate-500">{user.email}</div></td>
                  <td className="px-3 py-4"><select className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px]" value={currentRole} onChange={(event) => void changeRole(user.userId, event.target.value as Role)}>{ROLES.map((item) => <option key={item} value={item}>{faRoleLabel(item)}</option>)}</select></td>
                  <td className="px-3 py-4"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${user.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{faDomainLabel(user.status)}</span></td>
                  <td className="px-3 py-4 text-[11px] text-slate-500">{user.lastLoginAt ? formatFaDateTime(user.lastLoginAt) : "هرگز"}</td>
                  <td className="px-5 py-4 text-end"><button className="me-2 text-[11px] font-semibold text-indigo-600" type="button" onClick={() => void changeStatus(user)}>{user.status === "active" ? "غیرفعال‌کردن" : "فعال‌سازی مجدد"}</button><button className="text-[11px] font-semibold text-red-600" type="button" onClick={() => void remove(user.userId)}>حذف</button></td>
                </tr>;
              })}
              {!loading && users.length === 0 ? <tr><td className="px-5 py-8 text-center text-slate-400" colSpan={5}>کاربری در سازمان پیدا نشد.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">دعوت‌نامه‌های در انتظار</h2>
        <div className="mt-3 space-y-2">
          {invitations.map((invitation) => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-3 text-xs"><div><div className="font-semibold text-slate-800">{invitation.email}</div><div className="mt-0.5 text-[10px] text-slate-500">{faRoleLabel(invitation.role)} · انقضا: {formatFaDateTime(invitation.expiresAt)}</div></div><span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">در انتظار ارسال</span></div>)}
          {!loading && invitations.length === 0 ? <p className="text-xs text-slate-400">دعوت‌نامه‌ای در انتظار نیست.</p> : null}
        </div>
      </section>
    </div>
  );
}
