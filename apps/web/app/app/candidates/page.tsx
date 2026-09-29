"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../../components/product/icon";
import { Panel, PersonAvatar, Pill } from "../../../components/product/recruiting-ui";
import { api } from "../../../lib/api";
import { formatFaDateTime } from "../../../lib/i18n";
import { resolveTenantIdentity, tenantHeaders } from "../../../lib/tenant-client";

type CandidateSummary = components["schemas"]["CandidateSummaryDto"];

function formatUpdatedAt(value: string): string {
  return formatFaDateTime(value);
}

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const identity = await resolveTenantIdentity();
        const result = await api.GET("/v1/candidates", { headers: tenantHeaders(identity) });
        if (result.error || !result.data) throw new Error("کاندیداها از سرویس جذب بارگذاری نشدند");
        if (active) setCandidates(result.data);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "کاندیداها بارگذاری نشدند");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const filteredCandidates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return candidates;
    return candidates.filter((candidate) =>
      [candidate.displayName, candidate.currentRole, candidate.currentCompany, candidate.location, ...candidate.skills]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [candidates, query]);

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1 text-[11px] font-medium text-indigo-600">هوشمندی کاندیدا</div>
        <h1 className="text-[28px] font-semibold tracking-[-.03em] text-slate-950">کاندیداها</h1>
        <p className="mt-1.5 text-[12px] text-slate-500">پروفایل‌های کاندیدا در سطح سازمان و ارتباط آن‌ها با فرایندهای استخدام فعال.</p>
      </div>

      {error ? <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-xs text-rose-700">{error}</div> : null}

      <Panel>
        <div className="border-b border-slate-200 p-4">
          <div className="relative min-w-[280px] flex-1">
            <Icon name="search" size={14} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-[10px] border border-slate-200 bg-slate-50 ps-10 pe-3 text-[11px] outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
              placeholder="جست‌وجو بر اساس نام، مهارت، شرکت، نقش یا محل..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table min-w-[980px]">
            <thead>
              <tr>
                {["کاندیدا", "نقش فعلی", "شرکت", "مهارت‌ها", "محل", "آخرین به‌روزرسانی"].map((heading) => (
                  <th key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-12 text-center text-slate-400">در حال بارگذاری کاندیداها…</td></tr>
              ) : filteredCandidates.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-slate-400">{candidates.length ? "کاندیدایی با این جست‌وجو پیدا نشد." : "هنوز کاندیدایی برای این سازمان ثبت نشده است."}</td></tr>
              ) : filteredCandidates.map((candidate, index) => (
                <tr key={candidate.id}>
                  <td>
                    <Link href={`/app/candidates/${candidate.id}`} className="flex items-center gap-3">
                      <PersonAvatar name={candidate.displayName} size={32} tone={index % 5} />
                      <div>
                        <div className="font-semibold text-slate-900">{candidate.displayName}</div>
                        <div className="mt-1 text-[9px] text-slate-400">پروفایل هوشمندی کاندیدا</div>
                      </div>
                    </Link>
                  </td>
                  <td className="font-medium text-slate-700">{candidate.currentRole || "—"}</td>
                  <td>{candidate.currentCompany || "—"}</td>
                  <td>
                    <div className="flex max-w-[300px] flex-wrap gap-1">
                      {candidate.skills.length ? candidate.skills.slice(0, 4).map((skill) => <Pill key={skill}>{skill}</Pill>) : <span className="text-slate-400">مهارتی ثبت نشده</span>}
                    </div>
                  </td>
                  <td>{candidate.location || "—"}</td>
                  <td className="whitespace-nowrap">{formatUpdatedAt(candidate.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-[10px] text-slate-400">
          <span>{filteredCandidates.length} از {candidates.length} کاندیدای ثبت‌شده</span>
          <span>تطبیق پیش از مصاحبه مختص هر پرونده استخدامی است و در فضای کاری موقعیت نمایش داده می‌شود.</span>
        </div>
      </Panel>
    </div>
  );
}
