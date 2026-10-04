"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { faDomainLabel } from "../../lib/i18n";
import { formatFaDigits, formatFaNumber, formatFaPercent } from "../../lib/fa-numbers";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { useInternalAccess } from "../product/internal-access";
import { Panel, Pill } from "../product/recruiting-ui";
import { JobCandidateIntake } from "./job-candidate-intake";
import { TechnicalInterviewScheduler } from "./technical-interview-scheduler";

type JobWorkspace = components["schemas"]["JobWorkspaceDto"];
type CandidateSummary = components["schemas"]["CandidateSummaryDto"];

function messageFrom(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "message" in value && typeof (value as { message?: unknown }).message === "string") {
    return String((value as { message: string }).message);
  }
  return fallback;
}

export function JobRecruitingWorkspace({ jobId }: { jobId: string }) {
  const access = useInternalAccess();
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [job, setJob] = useState<JobWorkspace>();
  const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();
  const [scheduleTarget, setScheduleTarget] = useState<{ applicationId: string; candidateName: string }>();
  const [invitation, setInvitation] = useState<{ candidateName: string; token?: string; otp?: string }>();

  async function load(resolvedIdentity?: TenantIdentity) {
    const currentIdentity = resolvedIdentity ?? identity ?? (await resolveTenantIdentity());
    if (!identity) setIdentity(currentIdentity);
    const headers = tenantHeaders(currentIdentity);
    const [jobResult, candidatesResult] = await Promise.all([
      api.GET("/v1/jobs/{jobId}/workspace", {
        params: { path: { jobId } },
        headers,
      }),
      api.GET("/v1/candidates", {
        params: { query: { jobId } },
        headers,
      }),
    ]);
    if (jobResult.error || !jobResult.data) throw new Error(messageFrom(jobResult.error, "فضای کاری موقعیت شغلی بارگذاری نشد"));
    setJob(jobResult.data);
    setCandidates(candidatesResult.error || !candidatesResult.data ? [] : candidatesResult.data);
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
        if (active) setMessage(error instanceof Error ? error.message : "بارگذاری ناموفق بود");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [jobId]);

  async function publishRubric() {
    if (!identity) return;
    setMessage(undefined);
    const result = await api.POST("/v1/jobs/{jobId}/rubric/publish", {
      params: { path: { jobId } },
      headers: tenantHeaders(identity),
    });
    const payload = (result.data ?? result.error ?? {}) as { message?: string; version?: number };
    setMessage(result.error ? messageFrom(payload, "انتشار ناموفق بود") : `نسخه ${formatFaDigits(String(payload.version ?? ""))} چارچوب ارزیابی منتشر شد.`);
    if (!result.error) await load(identity);
  }

  async function moveStage(applicationId: string, stage: string) {
    if (!identity) return;
    const reason = window.prompt(`دلیل انتقال به مرحله «${faDomainLabel(stage)}»`)?.trim();
    if (!reason) return;
    const result = await api.POST("/v1/applications/{applicationId}/stage", {
      params: { path: { applicationId } },
      headers: tenantHeaders(identity),
      body: { stage, reason },
    });
    setMessage(result.error ? messageFrom(result.error, "انتقال مرحله ناموفق بود") : `پرونده به مرحله «${faDomainLabel(stage)}» منتقل شد.`);
    if (!result.error) await load(identity);
  }

  async function inviteCandidate(candidate: CandidateSummary) {
    if (!identity || !candidate.applicationId) return;
    setMessage(undefined);
    const result = await api.POST("/v1/candidate-auth/invitations", {
      headers: tenantHeaders(identity),
      body: { applicationId: candidate.applicationId },
    });
    const payload = (result.data ?? result.error ?? {}) as {
      message?: string;
      developmentToken?: string;
      developmentOtp?: string;
    };
    if (result.error) {
      setMessage(messageFrom(payload, "دعوت کاندید ناموفق بود"));
      return;
    }
    setInvitation({
      candidateName: candidate.displayName,
      ...(payload.developmentToken ? { token: payload.developmentToken } : {}),
      ...(payload.developmentOtp ? { otp: payload.developmentOtp } : {}),
    });
    setMessage("دعوت کاندید ایجاد شد.");
  }

  async function saveShortlist() {
    if (!identity || selected.size === 0) return;
    const entries = candidates
      .filter((candidate) => candidate.applicationId && selected.has(candidate.applicationId))
      .map((candidate, index) => ({ applicationId: candidate.applicationId!, rank: index + 1, rationale: "انتخاب انسانی برای فهرست نهایی" }));
    const result = await api.PUT("/v1/jobs/{jobId}/shortlist", {
      params: { path: { jobId } },
      headers: tenantHeaders(identity),
      body: { name: "فهرست نهایی اصلی", status: "review", entries },
    });
    const payload = (result.data ?? result.error ?? {}) as { message?: string; entryCount?: number };
    setMessage(result.error ? messageFrom(payload, "به‌روزرسانی فهرست نهایی ناموفق بود") : `${formatFaNumber(Number(payload.entryCount ?? entries.length))} کاندیدا در فهرست نهایی ذخیره شدند.`);
  }

  if (loading) return <div className="py-16 text-center text-sm text-slate-500">در حال بارگذاری فضای کاری موقعیت…</div>;
  if (!job) return <div className="rounded-xl border border-rose-100 bg-rose-50 p-5 text-sm text-rose-700">{message || "موقعیت شغلی پیدا نشد"}</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] text-slate-400">موقعیت‌های شغلی / {job.id}</div>
          <div className="mt-2 flex items-center gap-2"><h1 className="text-[24px] font-semibold tracking-tight">{job.title}</h1><Pill tone={job.status === "open" ? "green" : "slate"}>{faDomainLabel(job.status)}</Pill></div>
          <p className="mt-1 text-[11px] text-slate-500">{[job.department, job.location, job.seniority].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex gap-2">
          {access.can("job.edit") ? <button type="button" onClick={() => void publishRubric()} className="h-10 rounded-[10px] border border-slate-200 bg-white px-4 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">انتشار آخرین چارچوب ارزیابی</button> : null}
          {access.can("decision.submit") && selected.size > 0 ? <button type="button" onClick={() => void saveShortlist()} className="h-10 rounded-[10px] bg-indigo-600 px-4 text-[11px] font-semibold text-white">ذخیره فهرست نهایی ({selected.size})</button> : null}
        </div>
      </div>

      {message ? <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] text-indigo-800">{message}</div> : null}

      {invitation ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-[10px] text-emerald-800">
          <div className="font-semibold">دعوت برای {invitation.candidateName} ایجاد شد.</div>
          {invitation.token ? (
            <div className="mt-2 space-y-1 font-mono text-[9px]">
              <div>Token: {invitation.token}</div>
              {invitation.otp ? <div>OTP: {invitation.otp}</div> : null}
              <Link
                className="inline-flex font-sans font-semibold text-indigo-600"
                href={`/candidate/invitation?token=${encodeURIComponent(invitation.token)}`}
                target="_blank"
              >
                باز کردن مسیر کاندید در تب جدید
              </Link>
            </div>
          ) : (
            <div className="mt-1">ارسال دعوت به ارائه‌دهنده ارتباطی واگذار شد.</div>
          )}
        </div>
      ) : null}

      <JobCandidateIntake
        jobId={jobId}
        rubricStatus={job.rubricStatus}
        attachedCandidateIds={new Set(candidates.map((candidate) => candidate.id))}
        onChanged={() => load(identity)}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Panel className="p-5">
            <h2 className="text-[13px] font-semibold">الزامات</h2>
            <div className="mt-4 space-y-2">{job.requirements.length ? job.requirements.map((requirement) => <div key={requirement.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 p-3"><div><div className="text-[11px] font-semibold text-slate-800">{requirement.name}</div><div className="mt-1 text-[9px] text-slate-500">{faDomainLabel(requirement.requirementType)}{requirement.minimumYears !== undefined ? ` · ${formatFaNumber(requirement.minimumYears)}+ سال` : ""}</div></div><span className="text-[9px] text-slate-400">وزن {formatFaNumber(requirement.weight)}</span></div>) : <div className="text-[10px] text-slate-400">هنوز الزامی ثبت نشده است.</div>}</div>
          </Panel>

          <Panel className="p-5">
            <h2 className="text-[13px] font-semibold">کاندیداها و مسیر جذب</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[820px] text-start text-[10px]">
                <thead className="text-slate-400"><tr><th className="pb-2">فهرست نهایی</th><th className="pb-2">کاندیدا</th><th className="pb-2">مرحله</th><th className="pb-2">سیگنال تطبیق</th><th className="pb-2">اقدامات</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {candidates.map((candidate) => (
                    <tr key={candidate.id}>
                      <td className="py-3"><input type="checkbox" disabled={!candidate.applicationId || !access.can("decision.submit")} checked={Boolean(candidate.applicationId && selected.has(candidate.applicationId))} onChange={() => { if (!candidate.applicationId) return; setSelected((current) => { const next = new Set(current); if (next.has(candidate.applicationId!)) next.delete(candidate.applicationId!); else next.add(candidate.applicationId!); return next; }); }} /></td>
                      <td className="py-3"><Link href={`/app/candidates/${candidate.id}`} className="font-semibold text-slate-800 hover:text-indigo-600">{candidate.displayName}</Link><div className="mt-0.5 text-[9px] text-slate-400">{candidate.currentRole || candidate.currentCompany || "کاندیدا"}</div></td>
                      <td className="py-3"><Pill>{faDomainLabel(candidate.pipelineStage)}</Pill></td>
                      <td className="py-3">{candidate.preInterviewMatchScore !== undefined ? formatFaPercent(candidate.preInterviewMatchScore) : "امتیازدهی نشده"}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1">
                          {access.can("candidate.move_stage") && candidate.applicationId && candidate.pipelineStage !== "screening" ? (
                            <button type="button" onClick={() => void moveStage(candidate.applicationId!, "screening")} className="rounded-md border border-slate-200 px-2 py-1 text-[9px] hover:bg-slate-50">ارسال به غربالگری</button>
                          ) : null}
                          {access.can("interview.assign") && candidate.applicationId && ["screening", "interview"].includes(candidate.pipelineStage ?? "") ? (
                            <button
                              type="button"
                              onClick={() => setScheduleTarget({ applicationId: candidate.applicationId!, candidateName: candidate.displayName })}
                              className="rounded-md border border-indigo-200 px-2 py-1 text-[9px] font-semibold text-indigo-700 hover:bg-indigo-50"
                            >
                              برنامه‌ریزی مصاحبه فنی
                            </button>
                          ) : null}
                          {access.can("candidate.contact") && candidate.applicationId ? (
                            <button type="button" onClick={() => void inviteCandidate(candidate)} className="rounded-md border border-emerald-200 px-2 py-1 text-[9px] font-semibold text-emerald-700 hover:bg-emerald-50">ایجاد دعوت کاندید</button>
                          ) : null}
                          {access.can("candidate.move_stage") && candidate.applicationId && candidate.pipelineStage !== "review" ? (
                            <button type="button" onClick={() => void moveStage(candidate.applicationId!, "review")} className="rounded-md border border-slate-200 px-2 py-1 text-[9px] hover:bg-slate-50">ارسال به بررسی</button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {scheduleTarget ? (
              <div className="mt-4">
                <TechnicalInterviewScheduler
                  applicationId={scheduleTarget.applicationId}
                  candidateName={scheduleTarget.candidateName}
                  onClose={() => setScheduleTarget(undefined)}
                  onScheduled={async () => {
                    await load(identity);
                    setMessage("مصاحبه فنی زمان‌بندی شد. از منوی «مصاحبه‌ها» می‌توانید آن را مدیریت کنید.");
                  }}
                />
              </div>
            ) : null}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel className="p-5">
            <h2 className="text-[13px] font-semibold">چارچوب ارزیابی</h2>
            <div className="mt-4 space-y-2">{job.rubricCriteria.map((criterion) => <div key={criterion.id} className="rounded-xl bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold text-slate-800">{criterion.label}</span><span className="text-[9px] text-slate-400">{formatFaNumber(criterion.weight)}</span></div><div className="mt-1 text-[9px] text-slate-500">{criterion.required ? "نیازمند شواهد" : "اختیاری"} · {criterion.criterionKey}</div></div>)}</div>
          </Panel>
          <Panel className="p-5"><h2 className="text-[13px] font-semibold">توزیع مراحل جذب</h2><div className="mt-4 space-y-2">{job.pipeline.map((stage) => <div key={stage.stage} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-[10px]"><span>{faDomainLabel(stage.stage)}</span><strong>{formatFaNumber(stage.count)}</strong></div>)}</div></Panel>
        </div>
      </div>
    </div>
  );
}
