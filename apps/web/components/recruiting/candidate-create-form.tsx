"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { resolveTenantIdentity, tenantHeaders } from "../../lib/tenant-client";
import { useInternalAccess } from "../product/internal-access";
import { Panel } from "../product/recruiting-ui";

export function CandidateCreateForm() {
  const router = useRouter();
  const access = useInternalAccess();
  const [displayName, setDisplayName] = useState("");
  const [primaryEmail, setPrimaryEmail] = useState("");
  const [primaryPhone, setPrimaryPhone] = useState("");
  const [currentRole, setCurrentRole] = useState("");
  const [currentCompany, setCurrentCompany] = useState("");
  const [location, setLocation] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState("fa");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!displayName.trim()) {
      setError("نام کاندیدا الزامی است.");
      return;
    }

    setSubmitting(true);
    setError(undefined);
    try {
      const identity = await resolveTenantIdentity();
      const result = await api.POST("/v1/candidates", {
        headers: tenantHeaders(identity),
        body: {
          displayName: displayName.trim(),
          ...(primaryEmail.trim() ? { primaryEmail: primaryEmail.trim() } : {}),
          ...(primaryPhone.trim() ? { primaryPhone: primaryPhone.trim() } : {}),
          ...(currentRole.trim() ? { currentRole: currentRole.trim() } : {}),
          ...(currentCompany.trim() ? { currentCompany: currentCompany.trim() } : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
          ...(preferredLanguage.trim() ? { preferredLanguage: preferredLanguage.trim() } : {}),
        },
      });
      if (result.error || !result.data) {
        throw new Error(apiErrorMessage(result, "ایجاد کاندیدا ناموفق بود"));
      }
      const candidate = result.data as { id: string };
      router.push(`/app/candidates/${candidate.id}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ایجاد کاندیدا ناموفق بود");
    } finally {
      setSubmitting(false);
    }
  }

  if (!access.can("candidate.resume_manage")) {
    return (
      <div className="rounded-xl border border-amber-100 bg-amber-50 p-5 text-sm text-amber-800">
        نقش فعلی اجازه ایجاد کاندیدا را ندارد.
      </div>
    );
  }

  const field = "h-10 w-full rounded-[10px] border border-slate-200 bg-white px-3 text-[12px] outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

  return (
    <div className="mx-auto max-w-[980px] space-y-5">
      <div>
        <div className="text-[10px] text-slate-400">کاندیداها / ایجاد</div>
        <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-slate-950">ایجاد کاندیدا</h1>
        <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">
          برای ثبت سریع اطلاعات پایه استفاده کنید. اگر رزومه دارید، مسیر «ورود رزومه‌محور» در صفحه کاندیداها اطلاعات و شواهد را خودکار استخراج می‌کند.
        </p>
      </div>

      <form onSubmit={submit}>
        <Panel className="p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">
              نام و نام خانوادگی
              <input required autoFocus className={field} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="مثلاً آرمان رحیمی" />
            </label>
            <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">
              ایمیل
              <input type="email" className={field} value={primaryEmail} onChange={(event) => setPrimaryEmail(event.target.value)} placeholder="candidate@example.com" />
            </label>
            <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">
              شماره تماس
              <input className={field} value={primaryPhone} onChange={(event) => setPrimaryPhone(event.target.value)} placeholder="۰۹۱۲..." />
            </label>
            <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">
              نقش فعلی
              <input className={field} value={currentRole} onChange={(event) => setCurrentRole(event.target.value)} placeholder="توسعه‌دهنده ارشد .NET" />
            </label>
            <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">
              شرکت فعلی
              <input className={field} value={currentCompany} onChange={(event) => setCurrentCompany(event.target.value)} placeholder="نام شرکت" />
            </label>
            <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">
              محل
              <input className={field} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="تهران" />
            </label>
            <label className="space-y-1.5 text-[10px] font-semibold text-slate-600 md:col-span-2">
              زبان ترجیحی
              <select className={field} value={preferredLanguage} onChange={(event) => setPreferredLanguage(event.target.value)}>
                <option value="fa">فارسی</option>
                <option value="en">انگلیسی</option>
              </select>
            </label>
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 p-3 text-[10px] leading-5 text-rose-700" role="alert">
              {error}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => router.push("/app/candidates")}
              disabled={submitting}
              className="h-10 rounded-[10px] border border-slate-200 bg-white px-4 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-10 rounded-[10px] bg-indigo-600 px-5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "در حال ایجاد…" : "ایجاد کاندیدا"}
            </button>
          </div>
        </Panel>
      </form>
    </div>
  );
}
