"use client";

import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { Panel } from "../product/recruiting-ui";

type InterviewerOption = { userId: string; email: string; displayName?: string };
type AssignmentOptions = { interviewers: InterviewerOption[] };

export function TechnicalInterviewScheduler({
  applicationId,
  candidateName,
  onClose,
  onScheduled,
}: {
  applicationId: string;
  candidateName: string;
  onClose: () => void;
  onScheduled: () => Promise<void>;
}) {
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [interviewers, setInterviewers] = useState<InterviewerOption[]>([]);
  const [interviewerUserId, setInterviewerUserId] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const current = await resolveTenantIdentity();
        if (!active) return;
        setIdentity(current);
        const result = await api.GET("/v1/interview-operations/assignment-options", {
          headers: tenantHeaders(current),
        });
        if (result.error || !result.data) {
          throw new Error(apiErrorMessage(result, "فهرست مصاحبه‌گران بارگذاری نشد"));
        }
        const payload = result.data as AssignmentOptions;
        if (active) setInterviewers(payload.interviewers ?? []);
      } catch (cause) {
        if (active) setMessage(cause instanceof Error ? cause.message : "فهرست مصاحبه‌گران بارگذاری نشد");
      }
    })();
    return () => {
      active = false;
    };
  }, [applicationId]);

  async function schedule() {
    if (!identity || !interviewerUserId || !scheduledFor) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const date = new Date(scheduledFor);
      if (Number.isNaN(date.getTime())) {
        setMessage("تاریخ و ساعت مصاحبه معتبر نیست.");
        return;
      }
      const result = await api.POST("/v1/interview-operations/technical-interviews", {
        headers: tenantHeaders(identity),
        body: {
          applicationId,
          interviewerUserId,
          scheduledFor: date.toISOString(),
          durationMinutes: Number(durationMinutes),
          language: "fa",
        },
      });
      if (result.error) {
        setMessage(apiErrorMessage(result, "زمان‌بندی مصاحبه فنی ناموفق بود"));
        return;
      }
      setMessage("مصاحبه فنی زمان‌بندی و به مصاحبه‌گر تخصیص داده شد.");
      await onScheduled();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="border-indigo-100 bg-indigo-50/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold text-slate-900">زمان‌بندی مصاحبه فنی · {candidateName}</div>
          <div className="mt-1 text-[9px] text-slate-500">
            Session انسانی، Interviewer Assignment و انتقال پرونده به مرحله مصاحبه در یک تراکنش ثبت می‌شوند.
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-[10px] font-semibold text-slate-500">بستن</button>
      </div>

      {message ? <div className="mt-3 rounded-lg bg-white px-3 py-2 text-[9px] text-indigo-800">{message}</div> : null}

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_140px_auto]">
        <select
          value={interviewerUserId}
          onChange={(event) => setInterviewerUserId(event.target.value)}
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[10px]"
        >
          <option value="">انتخاب مصاحبه‌گر فنی…</option>
          {interviewers.map((interviewer) => (
            <option key={interviewer.userId} value={interviewer.userId}>
              {interviewer.displayName || interviewer.email}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={scheduledFor}
          onChange={(event) => setScheduledFor(event.target.value)}
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[10px]"
        />
        <select
          value={durationMinutes}
          onChange={(event) => setDurationMinutes(event.target.value)}
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[10px]"
        >
          <option value="30">۳۰ دقیقه</option>
          <option value="45">۴۵ دقیقه</option>
          <option value="60">۶۰ دقیقه</option>
          <option value="90">۹۰ دقیقه</option>
        </select>
        <button
          type="button"
          onClick={() => void schedule()}
          disabled={busy || !interviewerUserId || !scheduledFor}
          className="h-10 rounded-lg bg-slate-950 px-4 text-[10px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? "در حال ثبت…" : "ثبت مصاحبه"}
        </button>
      </div>
      {interviewers.length === 0 ? (
        <div className="mt-3 text-[9px] text-amber-700">
          مصاحبه‌گر فعالی با نقش INTERVIEWER پیدا نشد. ابتدا از تنظیمات کاربران یک مصاحبه‌گر بسازید یا نقش کاربر را تغییر دهید.
        </div>
      ) : null}
    </Panel>
  );
}
