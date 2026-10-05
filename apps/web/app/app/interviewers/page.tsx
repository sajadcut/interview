"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "../../../components/product/icon";
import { Panel, Pill, ToolbarButton } from "../../../components/product/recruiting-ui";
import { InlineFeedback } from "../../../components/product/collection-management";
import { useInternalAccess } from "../../../components/product/internal-access";
import { api, apiErrorMessage } from "../../../lib/api";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../../lib/tenant-client";

type HumanInterviewer = {
  userId: string;
  email: string;
  displayName?: string;
};

type Invitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
};

export default function InterviewersPage() {
  const access = useInternalAccess();
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [humans, setHumans] = useState<HumanInterviewer[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();

  const load = useCallback(async (known?: TenantIdentity) => {
    const current = known ?? identity ?? (await resolveTenantIdentity());
    if (!identity) setIdentity(current);
    const headers = tenantHeaders(current);
    const [optionsResult, invitationsResult] = await Promise.all([
      api.GET("/v1/interview-operations/assignment-options", { headers }),
      access.can("organization.manage_users")
        ? api.GET("/v1/organization/users/invitations", { headers })
        : Promise.resolve(undefined),
    ]);
    if (optionsResult.error || !optionsResult.data) {
      throw new Error(apiErrorMessage(optionsResult, "فهرست مصاحبه‌گرها بارگذاری نشد"));
    }
    const payload = optionsResult.data as { interviewers?: HumanInterviewer[] };
    setHumans(payload.interviewers ?? []);
    if (invitationsResult?.error) {
      throw new Error(apiErrorMessage(invitationsResult, "دعوت‌نامه‌های مصاحبه‌گر بارگذاری نشدند"));
    }
    setInvitations(
      ((invitationsResult?.data ?? []) as Invitation[]).filter((item) => item.role === "INTERVIEWER"),
    );
  }, [access, identity]);

  useEffect(() => {
    let active = true;
    void resolveTenantIdentity()
      .then(async (resolved) => {
        if (!active) return;
        setIdentity(resolved);
        await load(resolved);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "فهرست مصاحبه‌گرها بارگذاری نشد");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!identity || !email.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    setFeedback(undefined);
    try {
      const result = await api.POST("/v1/organization/users/invitations", {
        headers: tenantHeaders(identity),
        body: { email: email.trim(), role: "INTERVIEWER" },
      });
      if (result.error) throw new Error(apiErrorMessage(result, "دعوت مصاحبه‌گر ناموفق بود"));
      setEmail("");
      setFeedback("دعوت‌نامه مصاحبه‌گر ارسال/ایجاد شد. پس از پذیرش، این شخص در فهرست مصاحبه‌گرهای انسانی فعال نمایش داده می‌شود.");
      await load(identity);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "دعوت مصاحبه‌گر ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  const filteredHumans = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return humans;
    return humans.filter((item) =>
      [item.displayName, item.email].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [humans, query]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-[11px] font-medium text-indigo-600">مدیریت مصاحبه</div>
          <h1 className="text-[28px] font-semibold tracking-[-.03em] text-slate-950">مصاحبه‌گرها</h1>
          <p className="mt-1.5 text-[12px] text-slate-500">
            مصاحبه‌گر هوش مصنوعی سیستمی است؛ مصاحبه‌گرهای انسانی از اعضای فعال سازمان با نقش «مصاحبه‌گر» ساخته می‌شوند.
          </p>
        </div>
        <Link href="/app/interviews">
          <ToolbarButton icon="interviews">مشاهده مصاحبه‌ها</ToolbarButton>
        </Link>
      </div>

      {error ? <InlineFeedback tone="error">{error}</InlineFeedback> : null}
      {feedback ? <InlineFeedback>{feedback}</InlineFeedback> : null}

      {access.can("organization.manage_users") ? (
        <Panel className="p-4">
          <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
            <label className="min-w-[280px] flex-1 text-[10px] font-semibold text-slate-600">
              افزودن مصاحبه‌گر انسانی
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="ایمیل عضو یا مصاحبه‌گر جدید..."
                className="mt-1.5 h-10 w-full rounded-[10px] border border-slate-200 bg-white px-3 text-[11px] outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="h-10 rounded-[10px] bg-indigo-600 px-4 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "در حال ایجاد…" : "دعوت با نقش مصاحبه‌گر"}
            </button>
          </form>
        </Panel>
      ) : null}

      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
          <div className="relative min-w-[280px] flex-1">
            <Icon name="search" size={14} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="جست‌وجوی مصاحبه‌گر بر اساس نام یا ایمیل..."
              className="h-10 w-full rounded-[10px] border border-slate-200 bg-slate-50 ps-10 pe-3 text-[11px] outline-none focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table min-w-[820px]">
            <thead>
              <tr>
                <th>مصاحبه‌گر</th>
                <th>نوع</th>
                <th>وضعیت</th>
                <th>شناسه / ایمیل</th>
                <th>مدیریت</th>
              </tr>
            </thead>
            <tbody>
              {!query.trim() || "هوش مصنوعی ai interviewer".includes(query.trim().toLowerCase()) ? (
                <tr>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 place-items-center rounded-full bg-indigo-100 text-indigo-700">
                        <Icon name="sparkles" size={16} />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">مصاحبه‌گر هوش مصنوعی</div>
                        <div className="mt-1 text-[9px] text-slate-400">AI Interviewer · actor سیستمی</div>
                      </div>
                    </div>
                  </td>
                  <td><Pill tone="blue">هوش مصنوعی</Pill></td>
                  <td><Pill tone="green">فعال</Pill></td>
                  <td className="text-slate-500">system:ai-interviewer</td>
                  <td className="text-[10px] text-slate-400">سیستمی · قابل حذف نیست</td>
                </tr>
              ) : null}

              {filteredHumans.map((interviewer) => (
                <tr key={interviewer.userId}>
                  <td>
                    <div className="font-semibold text-slate-900">{interviewer.displayName || interviewer.email}</div>
                    <div className="mt-1 text-[9px] text-slate-400">عضو سازمان</div>
                  </td>
                  <td><Pill>انسان</Pill></td>
                  <td><Pill tone="green">فعال</Pill></td>
                  <td className="text-slate-500">{interviewer.email}</td>
                  <td>
                    {access.can("organization.manage_users") ? (
                      <Link href="/app/settings/users" className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800">
                        مدیریت حساب و نقش
                      </Link>
                    ) : (
                      <span className="text-[10px] text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}

              {loading ? <tr><td colSpan={5} className="py-10 text-center text-slate-400">در حال بارگذاری مصاحبه‌گرها…</td></tr> : null}
              {!loading && filteredHumans.length === 0 && query.trim() ? (
                <tr><td colSpan={5} className="py-10 text-center text-slate-400">مصاحبه‌گر انسانی با این جست‌وجو پیدا نشد.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {invitations.length ? (
          <div className="border-t border-slate-100 px-4 py-3">
            <div className="text-[10px] font-semibold text-slate-600">دعوت‌نامه‌های مصاحبه‌گر در انتظار</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {invitations.map((item) => (
                <span key={item.id} className="rounded-full bg-amber-50 px-2.5 py-1 text-[9px] font-medium text-amber-700">
                  {item.email}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
