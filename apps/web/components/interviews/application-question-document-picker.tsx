"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { formatFaNumber } from "../../lib/fa-numbers";
import { resolveTenantIdentity, tenantHeaders } from "../../lib/tenant-client";
import { useInternalAccess } from "../product/internal-access";

type Selection = components["schemas"]["ApplicationQuestionDocumentsDto"];

export function ApplicationQuestionDocumentPicker({
  applicationId,
  candidateName,
}: {
  applicationId: string;
  candidateName: string;
}) {
  const access = useInternalAccess();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function openPicker() {
    if (loading) return;
    setOpen(true);
    setLoading(true);
    setError("");
    try {
      const identity = await resolveTenantIdentity();
      const result = await api.GET("/v1/question-bank/applications/{applicationId}/documents", {
        headers: tenantHeaders(identity), params: { path: { applicationId } },
      });
      if (result.error || !result.data) throw new Error(apiErrorMessage(result, "فهرست مستندات دریافت نشد"));
      setSelection(result.data);
      setIds(result.data.selectedDocumentIds);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "خطای بارگذاری");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!selection || selection.locked || saving) return;
    setSaving(true);
    setError("");
    try {
      const identity = await resolveTenantIdentity();
      const result = await api.PUT("/v1/question-bank/applications/{applicationId}/documents", {
        headers: tenantHeaders(identity), params: { path: { applicationId } },
        body: { documentIds: ids },
      });
      if (result.error) throw new Error(apiErrorMessage(result, "ذخیره انتخاب مستندات ناموفق بود"));
      setMessage(`برای «${candidateName}» تعداد ${formatFaNumber(ids.length)} مستند مصاحبه ثبت شد.`);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ذخیره ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  if (!access.can("interview.assign")) return null;
  return (
    <>
      <button type="button" onClick={() => void openPicker()}
        className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50">
        مستندات سؤال
      </button>
      {message ? <span role="status" className="block max-w-56 text-[10px] text-emerald-700">{message}</span> : null}
      {open ? (
        <div role="dialog" aria-modal="true" aria-label={`انتخاب مستندات مصاحبه ${candidateName}`}
          className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/70 p-4" dir="rtl">
          <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 text-start shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">مستندات مصاحبه «{candidateName}»</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-3 py-2 text-xs" aria-label="بستن انتخاب مستندات">بستن</button>
            </div>
            <p className="mt-2 text-xs leading-6 text-slate-500">
              فقط مستندات موقعیت شغلی این کاندیدا نمایش داده می‌شوند. حداکثر ۸ فایل را انتخاب کنید.
              پس از شروع مصاحبه انتخاب‌ها قفل می‌شوند.
            </p>
            {error ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{error}</p> : null}
            {loading ? <p className="py-7 text-center text-xs text-slate-500">در حال دریافت…</p> : null}
            {selection?.locked ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">مصاحبه شروع شده یا پایان یافته است؛ انتخاب مستندات این پرونده قابل تغییر نیست.</p> : null}
            {selection && selection.availableDocuments.length === 0 ? (
              <p className="mt-4 rounded-lg bg-slate-50 p-4 text-xs text-slate-600">
                برای این شغل مستندی ثبت نشده است. <Link href="/app/question-bank" className="font-semibold text-indigo-700 underline">رفتن به بانک سؤال</Link>
              </p>
            ) : null}
            <div className="mt-4 space-y-2">
              {selection?.availableDocuments.map((doc) => (
                <label key={doc.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
                  <input type="checkbox" disabled={selection.locked} checked={ids.includes(doc.id)}
                    className="mt-1 size-4 accent-indigo-600"
                    onChange={(event) => setIds((current) =>
                      event.target.checked ? (current.length < 8 ? [...current, doc.id] : current) : current.filter((id) => id !== doc.id),
                    )} />
                  <span className="min-w-0">
                    <span className="block break-all text-xs font-semibold text-slate-800">{doc.fileName}</span>
                    <span className="mt-1 block line-clamp-2 text-[11px] leading-5 text-slate-500">{doc.preview || "متن سند برای سؤالات آماده است"}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <span className="text-xs text-slate-500">{formatFaNumber(ids.length)} فایل انتخاب شده</span>
              <button type="button" disabled={loading || saving || !selection || selection.locked}
                onClick={() => void save()}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-40">
                {saving ? "در حال ذخیره…" : "ذخیره مستندات این مصاحبه"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
