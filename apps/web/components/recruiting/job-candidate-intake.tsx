"use client";

import type { components } from "@interview/api-client";
import { useEffect, useMemo, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { useInternalAccess } from "../product/internal-access";
import { Panel } from "../product/recruiting-ui";

type CandidateSummary = components["schemas"]["CandidateSummaryDto"];

interface NewCandidateForm {
  displayName: string;
  primaryEmail: string;
  primaryPhone: string;
  currentRole: string;
  currentCompany: string;
  location: string;
}

const emptyForm: NewCandidateForm = {
  displayName: "",
  primaryEmail: "",
  primaryPhone: "",
  currentRole: "",
  currentCompany: "",
  location: "",
};

export function JobCandidateIntake({
  jobId,
  rubricStatus,
  attachedCandidateIds,
  onChanged,
}: {
  jobId: string;
  rubricStatus?: string;
  attachedCandidateIds: ReadonlySet<string>;
  onChanged: () => Promise<void>;
}) {
  const access = useInternalAccess();
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [allCandidates, setAllCandidates] = useState<CandidateSummary[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [form, setForm] = useState<NewCandidateForm>(emptyForm);
  const [busy, setBusy] = useState<"existing" | "new">();
  const [message, setMessage] = useState<string>();

  const availableCandidates = useMemo(
    () => allCandidates.filter((candidate) => !attachedCandidateIds.has(candidate.id)),
    [allCandidates, attachedCandidateIds],
  );

  async function loadCandidates(current?: TenantIdentity) {
    const resolved = current ?? identity ?? (await resolveTenantIdentity());
    if (!identity) setIdentity(resolved);
    const result = await api.GET("/v1/candidates", { headers: tenantHeaders(resolved) });
    if (result.error || !result.data) {
      throw new Error(apiErrorMessage(result, "فهرست کاندیداها بارگذاری نشد"));
    }
    setAllCandidates(result.data);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const resolved = await resolveTenantIdentity();
        if (!active) return;
        setIdentity(resolved);
        await loadCandidates(resolved);
      } catch (cause) {
        if (active) setMessage(cause instanceof Error ? cause.message : "کاندیداها بارگذاری نشدند");
      }
    })();
    return () => {
      active = false;
    };
  }, [jobId]);

  async function introduce(candidateId: string, source: string) {
    if (!identity) return false;
    const result = await api.POST("/v1/jobs/{jobId}/applications", {
      params: { path: { jobId } },
      headers: tenantHeaders(identity),
      body: { candidateId, source, pipelineStage: "new" },
    });
    if (result.error) {
      setMessage(apiErrorMessage(result, "معرفی کاندید به موقعیت ناموفق بود"));
      return false;
    }
    await Promise.all([loadCandidates(identity), onChanged()]);
    return true;
  }

  async function introduceExisting() {
    if (!selectedCandidateId || !identity) return;
    setBusy("existing");
    setMessage(undefined);
    try {
      const ok = await introduce(selectedCandidateId, "manual_existing_candidate");
      if (ok) {
        setSelectedCandidateId("");
        setMessage("کاندید موجود به این موقعیت معرفی شد و پرونده استخدامی ایجاد شد.");
      }
    } finally {
      setBusy(undefined);
    }
  }

  async function createAndIntroduce() {
    if (!identity || !form.displayName.trim() || !form.primaryEmail.trim()) return;
    setBusy("new");
    setMessage(undefined);
    try {
      const result = await api.POST("/v1/candidates", {
        headers: tenantHeaders(identity),
        body: {
          displayName: form.displayName.trim(),
          ...(form.primaryEmail.trim() ? { primaryEmail: form.primaryEmail.trim() } : {}),
          ...(form.primaryPhone.trim() ? { primaryPhone: form.primaryPhone.trim() } : {}),
          ...(form.currentRole.trim() ? { currentRole: form.currentRole.trim() } : {}),
          ...(form.currentCompany.trim() ? { currentCompany: form.currentCompany.trim() } : {}),
          ...(form.location.trim() ? { location: form.location.trim() } : {}),
          preferredLanguage: "fa",
        },
      });
      const payload = (result.data ?? result.error ?? {}) as { id?: string };
      if (result.error || !payload.id) {
        setMessage(apiErrorMessage(result, "ایجاد کاندید ناموفق بود"));
        return;
      }
      const ok = await introduce(payload.id, "manual_new_candidate");
      if (ok) {
        setForm(emptyForm);
        setMessage("کاندید جدید ساخته شد و به این موقعیت معرفی شد.");
      }
    } finally {
      setBusy(undefined);
    }
  }

  const published = rubricStatus === "published";
  if (!access.can("candidate.move_stage")) return null;

  const fieldClass =
    "h-9 rounded-lg border border-slate-200 bg-white px-3 text-[10px] outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50";

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold text-slate-900">معرفی کاندید به موقعیت</h2>
          <p className="mt-1 text-[9px] leading-4 text-slate-500">
            Candidate در سطح سازمان باقی می‌ماند و برای این موقعیت یک Application مستقل ساخته می‌شود.
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${
          published ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
        }`}>
          {published ? "چارچوب ارزیابی منتشر شده" : "ابتدا چارچوب ارزیابی را منتشر کنید"}
        </span>
      </div>

      {message ? (
        <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-[9px] text-indigo-800">
          {message}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-100 p-4">
          <div className="text-[10px] font-semibold text-slate-700">انتخاب کاندید موجود</div>
          <div className="mt-3 flex gap-2">
            <select
              className={`${fieldClass} min-w-0 flex-1`}
              value={selectedCandidateId}
              onChange={(event) => setSelectedCandidateId(event.target.value)}
              disabled={!published || busy !== undefined}
            >
              <option value="">انتخاب کاندید…</option>
              {availableCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.displayName}{candidate.currentRole ? ` · ${candidate.currentRole}` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void introduceExisting()}
              disabled={!published || !selectedCandidateId || busy !== undefined}
              className="rounded-lg bg-slate-950 px-3 text-[10px] font-semibold text-white disabled:opacity-40"
            >
              {busy === "existing" ? "در حال معرفی…" : "معرفی"}
            </button>
          </div>
          <div className="mt-2 text-[9px] text-slate-400">
            {availableCandidates.length ? `${availableCandidates.length} کاندید قابل انتخاب` : "کاندید دیگری در بانک سازمان وجود ندارد."}
          </div>
        </div>

        {access.can("candidate.resume_manage") ? (
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="text-[10px] font-semibold text-slate-700">کاندید جدید</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input required className={fieldClass} placeholder="نام و نام خانوادگی *" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              <input required className={fieldClass} type="email" placeholder="ایمیل *" value={form.primaryEmail} onChange={(e) => setForm({ ...form, primaryEmail: e.target.value })} />
              <input className={fieldClass} placeholder="موبایل" value={form.primaryPhone} onChange={(e) => setForm({ ...form, primaryPhone: e.target.value })} />
              <input className={fieldClass} placeholder="نقش فعلی" value={form.currentRole} onChange={(e) => setForm({ ...form, currentRole: e.target.value })} />
              <input className={fieldClass} placeholder="شرکت فعلی" value={form.currentCompany} onChange={(e) => setForm({ ...form, currentCompany: e.target.value })} />
              <input className={fieldClass} placeholder="محل" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <button
              type="button"
              onClick={() => void createAndIntroduce()}
              disabled={!published || !form.displayName.trim() || !form.primaryEmail.trim() || busy !== undefined}
              className="mt-3 h-9 w-full rounded-lg bg-indigo-600 px-3 text-[10px] font-semibold text-white disabled:opacity-40"
            >
              {busy === "new" ? "در حال ساخت پرونده…" : "ایجاد کاندید و معرفی به موقعیت"}
            </button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
