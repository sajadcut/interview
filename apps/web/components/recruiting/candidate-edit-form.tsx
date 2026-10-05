"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { useInternalAccess } from "../product/internal-access";
import { Panel } from "../product/recruiting-ui";

type CandidateWorkspace = components["schemas"]["CandidateWorkspaceDto"];

export function CandidateEditForm({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const access = useInternalAccess();
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [candidate, setCandidate] = useState<CandidateWorkspace>();
  const [displayName, setDisplayName] = useState("");
  const [primaryEmail, setPrimaryEmail] = useState("");
  const [primaryPhone, setPrimaryPhone] = useState("");
  const [currentRole, setCurrentRole] = useState("");
  const [currentCompany, setCurrentCompany] = useState("");
  const [location, setLocation] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const resolved = await resolveTenantIdentity();
        const result = await api.GET("/v1/candidates/{candidateId}/workspace", {
          params: { path: { candidateId } },
          headers: tenantHeaders(resolved),
        });
        if (result.error || !result.data) {
          throw new Error(apiErrorMessage(result, "پروفایل کاندیدا بارگذاری نشد"));
        }
        if (!active) return;
        setIdentity(resolved);
        setCandidate(result.data);
        setDisplayName(result.data.displayName);
        setPrimaryEmail(result.data.primaryEmail ?? "");
        setPrimaryPhone(result.data.primaryPhone ?? "");
        setCurrentRole(result.data.currentRole ?? "");
        setCurrentCompany(result.data.currentCompany ?? "");
        setLocation(result.data.location ?? "");
        setPreferredLanguage(result.data.preferredLanguage ?? "");
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "پروفایل کاندیدا بارگذاری نشد");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [candidateId]);

  async function save() {
    if (!identity || !candidate || saving) return;
    if (!displayName.trim()) {
      setError("نام کاندیدا الزامی است.");
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      const result = await api.PATCH("/v1/candidates/{candidateId}", {
        params: { path: { candidateId } },
        headers: tenantHeaders(identity),
        body: {
          displayName: displayName.trim(),
          primaryEmail: primaryEmail.trim() || null,
          primaryPhone: primaryPhone.trim() || null,
          currentRole: currentRole.trim() || null,
          currentCompany: currentCompany.trim() || null,
          location: location.trim() || null,
          preferredLanguage: preferredLanguage.trim() || null,
        },
      });
      if (result.error) throw new Error(apiErrorMessage(result, "ذخیره تغییرات کاندیدا ناموفق بود"));
      router.push(`/app/candidates/${candidateId}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ذخیره تغییرات کاندیدا ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="py-16 text-center text-sm text-slate-500">در حال بارگذاری پروفایل…</div>;
  if (!candidate) return <div className="rounded-xl border border-rose-100 bg-rose-50 p-5 text-sm text-rose-700">{error || "کاندیدا پیدا نشد"}</div>;
  if (!access.can("candidate.resume_manage")) return <div className="rounded-xl border border-amber-100 bg-amber-50 p-5 text-sm text-amber-800">نقش فعلی اجازه ویرایش پروفایل کاندیدا را ندارد.</div>;

  const field = "h-10 w-full rounded-[10px] border border-slate-200 bg-white px-3 text-[12px] outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

  return (
    <div className="mx-auto max-w-[960px] space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] text-slate-400">کاندیداها / {candidate.displayName} / ویرایش</div>
          <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-slate-950">ویرایش پروفایل کاندیدا</h1>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">
            اطلاعات هویتی و شغلی را اصلاح کنید. شواهد رزومه، مهارت‌ها و پرونده‌های استخدامی مستقل از این فرم نگه‌داری می‌شوند.
          </p>
        </div>
        <Link href={`/app/candidates/${candidateId}`} className="rounded-[10px] border border-slate-200 bg-white px-4 py-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
          بازگشت به پروفایل
        </Link>
      </div>

      {error ? <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-[11px] text-rose-700">{error}</div> : null}

      <Panel className="p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">نام و نام خانوادگی
            <input className={field} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">ایمیل
            <input className={field} type="email" value={primaryEmail} onChange={(event) => setPrimaryEmail(event.target.value)} />
          </label>
          <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">شماره تماس
            <input className={field} value={primaryPhone} onChange={(event) => setPrimaryPhone(event.target.value)} />
          </label>
          <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">نقش فعلی
            <input className={field} value={currentRole} onChange={(event) => setCurrentRole(event.target.value)} />
          </label>
          <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">شرکت فعلی
            <input className={field} value={currentCompany} onChange={(event) => setCurrentCompany(event.target.value)} />
          </label>
          <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">محل
            <input className={field} value={location} onChange={(event) => setLocation(event.target.value)} />
          </label>
          <label className="space-y-1.5 text-[10px] font-semibold text-slate-600">زبان ترجیحی
            <input className={field} value={preferredLanguage} onChange={(event) => setPreferredLanguage(event.target.value)} placeholder="fa" />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Link href={`/app/candidates/${candidateId}`} className="inline-flex h-10 items-center rounded-[10px] border border-slate-200 bg-white px-4 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
            انصراف
          </Link>
          <button type="button" disabled={saving} onClick={() => void save()} className="h-10 rounded-[10px] bg-indigo-600 px-4 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "در حال ذخیره…" : "ذخیره تغییرات"}
          </button>
        </div>
      </Panel>
    </div>
  );
}
