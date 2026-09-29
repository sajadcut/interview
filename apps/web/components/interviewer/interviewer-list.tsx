"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { faDomainLabel, formatFaDateTime } from "../../lib/i18n";
import { resolveTenantIdentity, tenantHeaders } from "../../lib/tenant-client";

type AssignedInterview = {
  assignmentId: string;
  assignmentStatus: string;
  scheduledFor?: string;
  sessionId: string;
  sessionStatus: string;
  candidateName: string;
  jobTitle: string;
};

export function InterviewerList({ title = "مصاحبه‌های من" }: { title?: string }) {
  const [items, setItems] = useState<AssignedInterview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void resolveTenantIdentity()
      .then(async (identity) => {
        const result = await api.GET("/v1/interviewer/interviews", {
          headers: tenantHeaders(identity),
        });
        if (result.response.status === 401) {
          window.location.replace("/login");
          return;
        }
        if (!result.response.ok) {
          throw new Error(apiErrorMessage(result, "مصاحبه‌های تخصیص‌یافته بارگذاری نشدند"));
        }
        if (active) setItems((result.data ?? []) as AssignedInterview[]);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "مصاحبه‌های تخصیص‌یافته بارگذاری نشدند");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-indigo-600">کارهای تخصیص‌یافته</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-.03em] text-slate-950">{title}</h1>
          <p className="mt-1 text-xs text-slate-500">فقط مصاحبه‌هایی که به حساب کاربری شما تخصیص یافته‌اند در این فضای کاری نمایش داده می‌شوند.</p>
        </div>
      </div>

      {error ? <div role="alert" className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div> : null}
      <div className="mt-5 grid gap-3">
        {items.map((item) => (
          <Link key={item.assignmentId} href={`/interviewer/session/${item.sessionId}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-200">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">{item.candidateName}</div>
                <div className="mt-1 text-xs text-slate-500">{item.jobTitle}</div>
              </div>
              <div className="text-end text-[10px] text-slate-500">
                <div className="font-semibold uppercase tracking-[.06em] text-indigo-600">{faDomainLabel(item.sessionStatus)}</div>
                <div className="mt-1">{item.scheduledFor ? formatFaDateTime(item.scheduledFor) : "زمان‌بندی نشده"}</div>
              </div>
            </div>
          </Link>
        ))}
        {!loading && items.length === 0 && !error ? <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">در حال حاضر مصاحبه‌ای به شما تخصیص داده نشده است.</div> : null}
        {loading ? <div role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">در حال بارگذاری تخصیص‌ها…</div> : null}
      </div>
    </section>
  );
}
