"use client";

import type { components } from "@interview/api-client";
import { useEffect, useState } from "react";
import { MetricCard, Panel, Pill, SectionHeader } from "../../../components/product/recruiting-ui";
import { api } from "../../../lib/api";
import { faDomainLabel } from "../../../lib/i18n";
import { formatFaNumber, formatFaPercent } from "../../../lib/fa-numbers";
import { resolveTenantIdentity, tenantHeaders } from "../../../lib/tenant-client";

type AnalyticsSummary = components["schemas"]["AnalyticsSummaryDto"];

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<AnalyticsSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const identity = await resolveTenantIdentity();
        const result = await api.GET("/v1/analytics/summary", { headers: tenantHeaders(identity) });
        if (result.error || !result.data) throw new Error("تحلیل‌های استخدام بارگذاری نشد");
        if (active) setSummary(result.data);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "تحلیل‌های استخدام بارگذاری نشد");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <div className="py-16 text-center text-sm text-slate-500">در حال بارگذاری تحلیل‌های استخدام…</div>;
  if (!summary) return <div className="rounded-xl border border-rose-100 bg-rose-50 p-5 text-sm text-rose-700">{error || "تحلیل‌ها در دسترس نیستند."}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-semibold tracking-[-.03em] text-slate-950">تحلیل‌های جذب و استخدام</h1>
        <p className="mt-1 text-[11px] text-slate-500">داده زنده سازمان برای قیف جذب، عملکرد منابع، بار بررسی و حاکمیت فرایند.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon="candidates" label="پرونده‌های استخدامی" value={String(summary.funnel.totalApplications)} note="پرونده‌های ثبت‌شده این سازمان" />
        <MetricCard icon="interviews" label="مصاحبه‌های تکمیل‌شده" value={String(summary.funnel.completedInterviews)} note="بررسی شواهد همچنان تحت کنترل انسان است" tone="violet" />
        <MetricCard icon="shield" label="بررسی‌های انسانی در انتظار" value={String(summary.funnel.pendingHumanReviews)} note="صف بررسی غربالگری و امتیازنامه" tone="emerald" />
        <MetricCard icon="target" label="منابع رهگیری‌شده" value={String(summary.sources.length)} note="انتساب عملیاتی منابع جذب" tone="amber" />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.15fr_.85fr]">
        <Panel>
          <SectionHeader title="قیف استخدام" subtitle="توزیع مراحل برای پایش عملیاتی است و امتیاز کاندیدا محسوب نمی‌شود." />
          <div className="space-y-3 p-5 pt-4">
            {summary.funnel.stages.length ? summary.funnel.stages.map((stage) => (
              <div key={stage.stage} className="grid grid-cols-[120px_1fr_72px] items-center gap-3 text-[11px]">
                <span className="truncate font-medium text-slate-700">{faDomainLabel(stage.stage)}</span>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(2, Math.min(100, stage.shareOfApplications))}%` }} />
                </div>
                <div className="text-end"><span className="font-semibold text-slate-900">{formatFaNumber(stage.count)}</span><span className="ms-1 text-slate-400">{formatFaPercent(stage.shareOfApplications)}</span></div>
              </div>
            )) : <div className="py-8 text-center text-[11px] text-slate-400">هنوز داده‌ای برای مراحل پرونده‌ها وجود ندارد.</div>}
          </div>
        </Panel>

        <Panel>
          <SectionHeader title="مرز حاکمیتی" subtitle="این شاخص‌ها برای چه تصمیم‌هایی مجاز یا غیرمجاز هستند." />
          <div className="space-y-3 p-5 pt-4 text-[10px] leading-5 text-slate-600">
            <div className="rounded-[10px] border border-indigo-100 bg-indigo-50/60 p-3 text-indigo-900">این تحلیل‌ها صرفاً پشتیبان تصمیم عملیاتی‌اند؛ امتیاز تطبیق پیش از مصاحبه از امتیازنامه مبتنی بر شواهد جداست و تصمیم نهایی استخدام انسانی باقی می‌ماند.</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[10px] border border-slate-100 p-3"><div className="text-slate-400">صف بررسی انسانی</div><div className="mt-1 text-lg font-semibold text-slate-900">{formatFaNumber(summary.funnel.pendingHumanReviews)}</div></div>
              <div className="rounded-[10px] border border-slate-100 p-3"><div className="text-slate-400">مصاحبه‌های تکمیل‌شده</div><div className="mt-1 text-lg font-semibold text-slate-900">{formatFaNumber(summary.funnel.completedInterviews)}</div></div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionHeader title="عملکرد منابع جذب" subtitle="سیگنال تطبیق پیش از مصاحبه از امتیازنامه مبتنی بر شواهد جدا نگه داشته می‌شود." />
        <div className="overflow-x-auto p-5 pt-4">
          <table className="w-full min-w-[720px] text-start text-[11px]">
            <thead className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-[.05em] text-slate-400">
              <tr><th className="pb-3">منبع</th><th className="pb-3">کاندیداها</th><th className="pb-3">میانگین تطبیق پیش از مصاحبه</th><th className="pb-3">رسیده به مصاحبه</th><th className="pb-3">نوع سیگنال</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.sources.length ? summary.sources.map((source) => (
                <tr key={source.source}>
                  <td className="py-3.5 font-semibold text-slate-800">{source.source}</td>
                  <td className="py-3.5 text-slate-600">{formatFaNumber(source.candidates)}</td>
                  <td className="py-3.5 text-slate-600">{source.averagePreInterviewMatchScore === undefined ? "—" : formatFaPercent(source.averagePreInterviewMatchScore)}</td>
                  <td className="py-3.5 text-slate-600">{formatFaNumber(source.interviewStageOrLater)}</td>
                  <td className="py-3.5"><Pill tone="blue">عملیاتی / بازیابی</Pill></td>
                </tr>
              )) : <tr><td colSpan={5} className="py-10 text-center text-slate-400">هنوز داده‌ای برای انتساب منبع جذب وجود ندارد.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
