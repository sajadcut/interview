"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { faDomainLabel } from "../../lib/i18n";
import { formatFaNumber } from "../../lib/fa-numbers";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { Panel, Pill } from "../product/recruiting-ui";
import { useInternalAccess } from "../product/internal-access";

interface TalentCandidate {
  candidateId: string;
  displayName: string;
  currentRole?: string;
  currentCompany?: string;
  skills: string[];
  tags: string[];
  status: string;
  updatedAt: string;
}

interface DuplicateReview {
  id: string;
  state: string;
  signals: Array<{ type?: string; strength?: string }>;
  canonicalCandidate: { id: string; displayName: string };
  duplicateCandidate: { id: string; displayName: string };
  createdAt: string;
}

export function TalentOperationsPanel() {
  const access = useInternalAccess();
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [candidates, setCandidates] = useState<TalentCandidate[]>([]);
  const [reviews, setReviews] = useState<DuplicateReview[]>([]);
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load(resolved?: TenantIdentity) {
    const current = resolved ?? identity ?? (await resolveTenantIdentity());
    if (!identity) setIdentity(current);
    const headers = tenantHeaders(current);
    const [talentResult, reviewResult] = await Promise.all([
      api.GET("/v1/talent", { headers }),
      api.GET("/v1/talent/dedupe/reviews", { headers }),
    ]);
    if (!talentResult.response.ok) {
      throw new Error(apiErrorMessage(talentResult, "بانک استعدادها بارگذاری نشد"));
    }
    if (!reviewResult.response.ok) {
      throw new Error(apiErrorMessage(reviewResult, "صف بررسی موارد تکراری بارگذاری نشد"));
    }
    setCandidates((talentResult.data ?? []) as TalentCandidate[]);
    setReviews((reviewResult.data ?? []) as DuplicateReview[]);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const resolved = await resolveTenantIdentity();
        if (!active) return;
        setIdentity(resolved);
        await load(resolved);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "بانک استعدادها بارگذاری نشد");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function scanDuplicates() {
    if (!identity) return;
    const result = await api.POST("/v1/talent/dedupe/scan", {
      headers: tenantHeaders(identity),
    });
    if (!result.response.ok) {
      setMessage(apiErrorMessage(result, "اسکن موارد تکراری ناموفق بود"));
      return;
    }
    const payload = result.data as { scannedPairs?: number; reviewsCreated?: number } | undefined;
    setMessage(`اسکن موارد تکراری انجام شد: ${formatFaNumber(payload?.scannedPairs ?? 0)} جفت بررسی شد و ${formatFaNumber(payload?.reviewsCreated ?? 0)} مورد جدید ساخته شد.`);
    await load(identity);
  }

  async function resolveReview(review: DuplicateReview, decision: "accepted" | "rejected") {
    if (!identity) return;
    const reason = window.prompt(decision === "accepted" ? "دلیل یکی‌کردن این رکورد تکراری" : "دلیل جدا نگه‌داشتن این کاندیداها")?.trim();
    if (!reason) return;
    const result = await api.POST("/v1/talent/dedupe/reviews/{reviewId}/resolve", {
      headers: tenantHeaders(identity),
      params: { path: { reviewId: review.id } },
      body: { decision, reason },
    });
    if (!result.response.ok) {
      setMessage(apiErrorMessage(result, "به‌روزرسانی بررسی ناموفق بود"));
      return;
    }
    setMessage(`بررسی رکورد تکراری: ${faDomainLabel(decision)}.`);
    await load(identity);
  }

  async function updateTags(candidate: TalentCandidate) {
    if (!identity) return;
    const raw = window.prompt("برچسب‌های استعداد، جداشده با ویرگول", candidate.tags.join(", "));
    if (raw === null) return;
    const tags = raw.split(",").map((tag) => tag.trim()).filter(Boolean);
    const result = await api.PATCH("/v1/talent/{candidateId}", {
      headers: tenantHeaders(identity),
      params: { path: { candidateId: candidate.candidateId } },
      body: { tags },
    });
    if (!result.response.ok) {
      setMessage(apiErrorMessage(result, "به‌روزرسانی استعداد ناموفق بود"));
      return;
    }
    setMessage("برچسب‌های استعداد به‌روزرسانی شدند.");
    await load(identity);
  }

  if (loading) return <div role="status" className="py-16 text-center text-sm text-slate-500">در حال بارگذاری بانک استعدادها…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 text-[10px] font-medium text-indigo-600">هوشمندی استعدادهای سازمان</div>
          <h1 className="text-[26px] font-semibold tracking-tight">بانک استعدادها</h1>
          <p className="mt-1 text-[12px] text-slate-500">اولویت با استعدادهای داخلی است؛ همراه با شواهد صریح و بررسی انسانی موارد تکراری.</p>
        </div>
        {access.can("talent.manage") ? <button type="button" onClick={() => void scanDuplicates()} className="h-10 rounded-[10px] bg-indigo-600 px-4 text-[11px] font-semibold text-white">اسکن هویت‌های تکراری</button> : null}
      </div>

      {message ? <div role="status" aria-live="polite" className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] text-indigo-800">{message}</div> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Panel className="p-5"><div className="text-[10px] text-slate-500">استعدادهای فعال</div><div className="mt-2 text-[28px] font-semibold">{formatFaNumber(candidates.filter((candidate) => candidate.status === "active").length)}</div></Panel>
        <Panel className="p-5"><div className="text-[10px] text-slate-500">بررسی‌های تکراری در انتظار</div><div className="mt-2 text-[28px] font-semibold">{formatFaNumber(reviews.length)}</div></Panel>
        <Panel className="p-5"><div className="text-[10px] text-slate-500">حالت یکپارچه‌سازی هویت</div><div className="mt-2 text-[14px] font-semibold">نام مستعار بدون حذف داده</div><div className="mt-1 text-[9px] text-slate-400">بدون ادغام مخرب و پنهان</div></Panel>
      </div>

      <Panel className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-[13px] font-semibold">رکوردهای استعداد</h2></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-start text-[10px]"><thead className="bg-slate-50 text-slate-400"><tr><th className="px-5 py-3">کاندیدا</th><th className="px-5 py-3">مهارت‌ها</th><th className="px-5 py-3">برچسب‌ها</th><th className="px-5 py-3">وضعیت</th><th className="px-5 py-3">اقدام</th></tr></thead><tbody className="divide-y divide-slate-100">{candidates.map((candidate) => <tr key={candidate.candidateId}><td className="px-5 py-3"><Link href={`/app/candidates/${candidate.candidateId}`} className="font-semibold text-slate-800 hover:text-indigo-600">{candidate.displayName}</Link><div className="mt-0.5 text-[9px] text-slate-400">{candidate.currentRole || candidate.currentCompany || "کاندیدا"}</div></td><td className="px-5 py-3">{candidate.skills.slice(0, 4).join(", ") || "—"}</td><td className="px-5 py-3">{candidate.tags.join(", ") || "—"}</td><td className="px-5 py-3"><Pill>{faDomainLabel(candidate.status)}</Pill></td><td className="px-5 py-3">{access.can("talent.manage") ? <button type="button" onClick={() => void updateTags(candidate)} className="rounded-md border border-slate-200 px-2 py-1 text-[9px]">ویرایش برچسب‌ها</button> : null}</td></tr>)}</tbody></table></div>
        {candidates.length === 0 ? <div className="border-t border-slate-100 p-5 text-center text-[10px] text-slate-500">هنوز رکوردی در بانک استعدادها وجود ندارد.</div> : null}
      </Panel>

      <Panel className="p-5">
        <h2 className="text-[13px] font-semibold">صف بررسی رکوردهای تکراری</h2>
        <div className="mt-4 space-y-2">{reviews.length ? reviews.map((review) => <div key={review.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"><div><div className="text-[10px] font-semibold text-slate-800">{review.canonicalCandidate.displayName} ← {review.duplicateCandidate.displayName}</div><div className="mt-1 text-[9px] text-slate-500">سیگنال‌ها: {review.signals.map((signal) => faDomainLabel(signal.type)).filter(Boolean).join("، ") || "بررسی شناسه‌های قوی"}</div></div>{access.can("talent.manage") ? <div className="flex gap-2"><button type="button" onClick={() => void resolveReview(review, "rejected")} className="rounded-lg border border-slate-200 px-3 py-2 text-[9px]">جدا نگه‌دار</button><button type="button" onClick={() => void resolveReview(review, "accepted")} className="rounded-lg bg-indigo-600 px-3 py-2 text-[9px] font-semibold text-white">یکپارچه‌سازی</button></div> : null}</div>) : <div className="rounded-xl bg-slate-50 p-4 text-[10px] text-slate-500">مورد تکراری در انتظار بررسی وجود ندارد.</div>}</div>
      </Panel>
    </div>
  );
}
