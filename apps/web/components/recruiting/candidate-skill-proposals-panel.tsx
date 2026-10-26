"use client";

import type { components } from "@interview/api-client";
import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { formatFaNumber, formatFaPercent } from "../../lib/fa-numbers";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { useInternalAccess } from "../product/internal-access";
import { Panel } from "../product/recruiting-ui";

type Resume = components["schemas"]["ResumeDto"];
type Proposal = components["schemas"]["SkillProposalDto"];

export function CandidateSkillProposalsPanel({ candidateId }: { candidateId: string }) {
  const access = useInternalAccess();
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [resumeId, setResumeId] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState<Record<string, string>>({});
  const [alias, setAlias] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const tenant = await resolveTenantIdentity();
        const result = await api.GET("/v1/candidates/{candidateId}/resumes", {
          params: { path: { candidateId } }, headers: tenantHeaders(tenant),
        });
        if (result.error) throw new Error(apiErrorMessage(result, "فهرست رزومه دریافت نشد."));
        if (!active) return;
        const available = (result.data ?? []).filter((item) => item.status === "completed");
        setIdentity(tenant);
        setResumes(available);
        setResumeId((old) => old || available[0]?.id || "");
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "خطای فهرست رزومه");
      }
    })();
    return () => { active = false; };
  }, [candidateId]);

  async function reloadProposals(tenant: TenantIdentity, selected: string) {
    const result = await api.GET("/v1/candidates/{candidateId}/resumes/{resumeId}/skill-proposals", {
      params: { path: { candidateId, resumeId: selected } }, headers: tenantHeaders(tenant),
    });
    if (result.error) throw new Error(apiErrorMessage(result, "پیشنهادها دریافت نشدند."));
    setProposals(result.data ?? []);
  }

  useEffect(() => {
    if (!identity || !resumeId) return;
    let active = true;
    setProposals([]);
    void (async () => {
      try {
        const result = await api.GET("/v1/candidates/{candidateId}/resumes/{resumeId}/skill-proposals", {
          params: { path: { candidateId, resumeId } }, headers: tenantHeaders(identity),
        });
        if (!active) return;
        if (result.error) throw new Error(apiErrorMessage(result, "پیشنهادها دریافت نشدند."));
        setProposals(result.data ?? []);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "دریافت پیشنهادها ناموفق بود");
      }
    })();
    return () => { active = false; };
  }, [identity, resumeId, candidateId]);

  async function generate() {
    if (!identity || !resumeId || !access.can("candidate.resume_manage")) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api.POST("/v1/candidates/{candidateId}/resumes/{resumeId}/skill-proposals/generate", {
        params: { path: { candidateId, resumeId } }, headers: tenantHeaders(identity),
      });
      if (result.error) throw new Error(apiErrorMessage(result, "درخواست پیشنهاد ناموفق بود."));
      const output = result.data;
      if (output?.status === "ok") {
        setMessage(`تعداد ${formatFaNumber(output.persistedCount)} پیشنهاد تازه برای بررسی ثبت شد. هیچ مهارتی خودکار تأیید نشده است.`);
      } else {
        setMessage("مدل برای این رزومه آماده نیست یا حجم متن پشتیبانی نمی‌شود؛ پردازش قطعی رزومه همچنان برقرار است.");
      }
      setProposals(output?.proposals ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ارتباط با مدل ناموفق بود");
    } finally { setBusy(false); }
  }

  async function review(item: Proposal, decision: "approved" | "rejected") {
    if (!identity || !resumeId || !access.can("candidate.resume_manage")) return;
    const explanation = (reason[item.id] ?? "").trim();
    if (explanation.length < 8) {
      setMessage("دلیل بررسی باید حداقل ۸ کاراکتر داشته باشد.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const reviewedAlias = (alias[item.id] ?? "").trim();
      const result = await api.PUT("/v1/candidates/{candidateId}/resumes/{resumeId}/skill-proposals/{proposalId}/review", {
        params: { path: { candidateId, resumeId, proposalId: item.id } },
        headers: tenantHeaders(identity),
        body: {
          decision, expectedVersion: item.reviewVersion, reason: explanation,
          ...(decision === "approved" && reviewedAlias ? { reviewedAlias } : {}),
        },
      });
      if (result.error) {
        if (result.response.status === 409) {
          await reloadProposals(identity, resumeId);
          setMessage("پیشنهاد تغییر کرده یا منبع رزومه به‌روزرسانی شده است؛ داده جدید را بررسی کنید.");
          return;
        }
        throw new Error(apiErrorMessage(result, "ثبت بازبینی ناموفق بود."));
      }
      setMessage("نظر انسانی ثبت شد؛ این نتیجه امتیاز فنی یا احراز مهارت نیست.");
      await reloadProposals(identity, resumeId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ثبت بررسی ناموفق بود");
    } finally { setBusy(false); }
  }

  if (!access.can("candidate.read")) return null;
  return <Panel className="space-y-3 p-5">
    <h2 className="text-[13px] font-semibold">پیشنهاد هوش مصنوعی برای مهارت‌های رزومه</h2>
    <p className="text-[10px] leading-5 text-slate-600">
      تنها با انتخاب صریح «درخواست پیشنهاد» متن استخراج‌شده این رزومه برای سرویس مدل پیکربندی‌شده ارسال می‌شود.
      پیشنهادها شواهد قطعی نیستند و برای هر تصمیم، بازبینی انسانی ضروری است.
    </p>
    {resumes.length ? <label className="block text-[10px] text-slate-700">
      رزومه
      <select value={resumeId} onChange={(event) => setResumeId(event.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2">
        {resumes.map((item) => <option key={item.id} value={item.id}>{item.originalFilename}</option>)}
      </select>
    </label> : <p className="text-[10px] text-slate-500">ابتدا یک رزومه پردازش‌شده بارگذاری کنید.</p>}
    {access.can("candidate.resume_manage") && resumeId ?
      <button type="button" disabled={busy} onClick={() => void generate()}
        className="rounded-lg border border-indigo-200 px-3 py-2 text-[10px] font-semibold text-indigo-700 disabled:opacity-50">
        {busy ? "در حال بررسی…" : "درخواست اختیاری پیشنهاد از مدل"}
      </button> : null}
    {message ? <p role="status" className="text-[10px] text-indigo-700">{message}</p> : null}
    <div className="space-y-3">{proposals.map((item) => <div key={item.id}
      className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong dir="ltr" className="text-[11px]">{item.skillKey}</strong>
        <span className="text-[10px] text-slate-500">{item.reviewState === "pending" ? "نیازمند بررسی" :
          item.reviewState === "approved" ? "پیشنهاد تأییدشده" : "پیشنهاد ردشده"}</span>
      </div>
      <blockquote className="mt-2 whitespace-pre-wrap border-s-2 border-indigo-200 ps-2 text-[10px] leading-5">{item.claimText}</blockquote>
      <p className="mt-1 text-[9px] text-slate-500">اطمینان پیشنهادی مدل: {formatFaPercent(item.confidence * 100)} · نسخه: {formatFaNumber(item.reviewVersion)}</p>
      {item.reviewState === "pending" && access.can("candidate.resume_manage") ?
        <div className="mt-2 space-y-2">
          <label className="block text-[10px] text-slate-700">دلیل انسانی
            <textarea rows={2} minLength={8} maxLength={1000} value={reason[item.id] ?? ""}
              onChange={(event) => setReason((old) => ({ ...old, [item.id]: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-200 p-2" />
          </label>
          <label className="block text-[10px] text-slate-700">نام دیگر مهارت در متن (اختیاری و تنها با تأیید)
            <input value={alias[item.id] ?? ""} maxLength={200} dir="ltr"
              onChange={(event) => setAlias((old) => ({ ...old, [item.id]: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-200 p-2"/>
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void review(item, "approved")}
              className="rounded-lg border border-emerald-200 px-3 py-1.5 text-[10px] text-emerald-700">تأیید پیشنهاد</button>
            <button type="button" disabled={busy} onClick={() => void review(item, "rejected")}
              className="rounded-lg border border-rose-200 px-3 py-1.5 text-[10px] text-rose-700">رد پیشنهاد</button>
          </div>
        </div> : null}
    </div>)}</div>
  </Panel>;
}
