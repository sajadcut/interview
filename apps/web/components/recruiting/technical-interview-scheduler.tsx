"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { Panel } from "../product/recruiting-ui";

type InterviewerOption = { userId: string; email: string; displayName?: string; specialties?: string[] };
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
  const [interviewerSelection, setInterviewerSelection] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const dateInputRef = useRef<HTMLInputElement>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const minDate = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, []);

  const selectedDatePreview = useMemo(() => {
    if (!scheduledDate || !scheduledTime) return undefined;
    const value = new Date(`${scheduledDate}T${scheduledTime}:00`);
    if (Number.isNaN(value.getTime())) return undefined;
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      dateStyle: "full",
      timeStyle: "short",
    }).format(value);
  }, [scheduledDate, scheduledTime]);

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
    if (!identity || !interviewerSelection) return;
    setBusy(true);
    setMessage(undefined);
    try {
      if (interviewerSelection === "ai") {
        const result = await api.POST("/v1/interview-operations/ai-interviews", {
          headers: tenantHeaders(identity),
          body: {
            applicationId,
            language: "fa",
          },
        });
        if (result.error || !result.data) {
          setMessage(apiErrorMessage(result, "ارسال کاندیدا به مصاحبه هوش مصنوعی ناموفق بود"));
          return;
        }
        const invitation = result.data.invitation;
        const devOtp = invitation.developmentOtp ? ` کد OTP تست: ${invitation.developmentOtp}` : "";
        setMessage(
          `مصاحبه AI آماده شد؛ پلن منتشرشده و دعوت کاندیدا ایجاد شد.${devOtp}`,
        );
        await onScheduled();
        return;
      }

      if (!scheduledDate || !scheduledTime) {
        setMessage("برای مصاحبه‌گر انسانی، تاریخ و ساعت مصاحبه را مشخص کنید.");
        return;
      }
      const date = new Date(`${scheduledDate}T${scheduledTime}:00`);
      if (Number.isNaN(date.getTime())) {
        setMessage("تاریخ یا ساعت مصاحبه معتبر نیست.");
        return;
      }
      if (date.getTime() <= Date.now()) {
        setMessage("زمان مصاحبه باید در آینده باشد.");
        return;
      }
      const result = await api.POST("/v1/interview-operations/technical-interviews", {
        headers: tenantHeaders(identity),
        body: {
          applicationId,
          interviewerUserId: interviewerSelection,
          scheduledFor: date.toISOString(),
          durationMinutes: Number(durationMinutes),
          language: "fa",
        },
      });
      if (result.error) {
        setMessage(apiErrorMessage(result, "زمان‌بندی مصاحبه فنی ناموفق بود"));
        return;
      }
      setMessage("مصاحبه فنی برای مصاحبه‌گر انسانی زمان‌بندی و ثبت شد.");
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
            ابتدا نوع مصاحبه‌گر را انتخاب کنید: هوش مصنوعی برای اجرای خودکار ساختاریافته، یا یکی از مصاحبه‌گرهای انسانی فعال سازمان.
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-[10px] font-semibold text-slate-500">بستن</button>
      </div>

      {message ? <div className="mt-3 rounded-lg bg-white px-3 py-2 text-[9px] text-indigo-800">{message}</div> : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.15fr_1fr_180px_140px_auto]">
        <select
          value={interviewerSelection}
          onChange={(event) => setInterviewerSelection(event.target.value)}
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[10px]"
        >
          <option value="">انتخاب مصاحبه‌گر…</option>
          <option value="ai">✨ مصاحبه‌گر هوش مصنوعی</option>
          {interviewers.map((interviewer) => (
            <option key={interviewer.userId} value={interviewer.userId}>
              👤 {interviewer.displayName || interviewer.email}
            </option>
          ))}
        </select>
        <label className="relative">
          <span className="mb-1 block text-[9px] font-semibold text-slate-500">تاریخ مصاحبه</span>
          <div className="relative">
            <input
              ref={dateInputRef}
              type="date"
              min={minDate}
              disabled={!interviewerSelection || interviewerSelection === "ai"}
              value={scheduledDate}
              onChange={(event) => {
                setScheduledDate(event.target.value);
                setMessage(undefined);
              }}
              dir="ltr"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 pe-10 text-[10px] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            />
            <button
              type="button"
              aria-label="باز کردن انتخاب تاریخ"
              disabled={!interviewerSelection || interviewerSelection === "ai"}
              onClick={() => {
                const input = dateInputRef.current;
                if (!input) return;
                const picker = input as HTMLInputElement & { showPicker?: () => void };
                picker.showPicker?.();
                input.focus();
              }}
              className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              📅
            </button>
          </div>
        </label>

        <label className="relative">
          <span className="mb-1 block text-[9px] font-semibold text-slate-500">ساعت</span>
          <div className="relative">
            <input
              ref={timeInputRef}
              type="time"
              step="300"
              disabled={!interviewerSelection || interviewerSelection === "ai"}
              value={scheduledTime}
              onChange={(event) => {
                setScheduledTime(event.target.value);
                setMessage(undefined);
              }}
              dir="ltr"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 pe-10 text-[10px] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            />
            <button
              type="button"
              aria-label="باز کردن انتخاب ساعت"
              disabled={!interviewerSelection || interviewerSelection === "ai"}
              onClick={() => {
                const input = timeInputRef.current;
                if (!input) return;
                const picker = input as HTMLInputElement & { showPicker?: () => void };
                picker.showPicker?.();
                input.focus();
              }}
              className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              🕒
            </button>
          </div>
        </label>
        <label>
          <span className="mb-1 block text-[9px] font-semibold text-slate-500">مدت مصاحبه</span>
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
        </label>
        <div className="flex items-end">
        <button
          type="button"
          onClick={() => void schedule()}
          disabled={busy || !interviewerSelection || (interviewerSelection !== "ai" && (!scheduledDate || !scheduledTime))}
          className="h-10 rounded-lg bg-slate-950 px-4 text-[10px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? "در حال ارسال…" : "ارسال به مصاحبه"}
        </button>
        </div>
      </div>
      {interviewerSelection && interviewerSelection !== "ai" ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[9px] leading-5 text-slate-600">
          {selectedDatePreview
            ? <>زمان انتخاب‌شده: <strong className="text-slate-800">{selectedDatePreview}</strong></>
            : "تاریخ و ساعت را جداگانه انتخاب کنید. زمان انتخاب‌شده قبل از ثبت به وقت محلی شما نمایش داده می‌شود."}
        </div>
      ) : null}
      {interviewerSelection === "ai" ? (
        <div className="mt-3 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[9px] leading-5 text-indigo-800">
          در حالت AI تاریخ و ساعت لازم نیست؛ با «ارسال به مصاحبه» پلن مصاحبه منتشر و دعوت امن کاندیدا در همان مرحله ساخته می‌شود.
        </div>
      ) : null}
      {interviewers.length === 0 ? (
        <div className="mt-3 text-[9px] text-amber-700">
          مصاحبه‌گر فعالی با نقش INTERVIEWER پیدا نشد. ابتدا از تنظیمات کاربران یک مصاحبه‌گر بسازید یا نقش کاربر را تغییر دهید.
        </div>
      ) : null}
    </Panel>
  );
}
