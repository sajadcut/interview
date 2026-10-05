"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { faDomainLabel, formatFaDateTime } from "../../lib/i18n";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { Icon } from "../product/icon";

type InterviewerOption = {
  userId: string;
  email: string;
  displayName?: string;
  specialties?: string[];
};

type SessionOption = {
  sessionId?: string;
  sessionStatus: string;
  applicationId: string;
  candidateName: string;
  jobTitle: string;
  interviewerUserId?: string;
  interviewerName?: string;
  interviewerEmail?: string;
  assignmentStatus?: string;
  scheduledFor?: string;
};

type Options = { sessions: SessionOption[]; interviewers: InterviewerOption[] };

const TERMINAL_SESSION_STATUSES = new Set(["completed", "cancelled", "failed"]);

function operationKey(session: SessionOption): string {
  return session.sessionId ?? `application:${session.applicationId}`;
}

function statusLabel(status: string): string {
  if (status === "needs_scheduling") return "نیازمند برنامه‌ریزی";
  return faDomainLabel(status);
}

function localDateParts(value: string): { date: string; time: string } | undefined {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return { date: `${year}-${month}-${day}`, time: `${hours}:${minutes}` };
}

export function InterviewOperations() {
  const [identity, setIdentity] = useState<TenantIdentity | null>(null);
  const [options, setOptions] = useState<Options>({ sessions: [], interviewers: [] });
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [scheduledDate, setScheduledDate] = useState<Record<string, string>>({});
  const [scheduledTime, setScheduledTime] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");

  const minDate = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, []);

  const load = useCallback(async () => {
    const current = identity ?? (await resolveTenantIdentity());
    if (!identity) setIdentity(current);
    const result = await api.GET("/v1/interview-operations/assignment-options", {
      headers: tenantHeaders(current),
    });
    if (result.response.status === 401) {
      window.location.replace("/login");
      return;
    }
    if (!result.response.ok || !result.data) {
      throw new Error(apiErrorMessage(result, "عملیات مصاحبه بارگذاری نشد"));
    }

    const data = result.data as Options;
    setOptions(data);

    const nextSelected: Record<string, string> = {};
    const nextDate: Record<string, string> = {};
    const nextTime: Record<string, string> = {};
    for (const session of data.sessions) {
      const key = operationKey(session);
      if (session.interviewerUserId) {
        nextSelected[key] = session.interviewerUserId;
      }
      if (session.scheduledFor) {
        const parts = localDateParts(session.scheduledFor);
        if (parts) {
          nextDate[key] = parts.date;
          nextTime[key] = parts.time;
        }
      }
    }
    setSelected(nextSelected);
    setScheduledDate(nextDate);
    setScheduledTime(nextTime);
  }, [identity]);

  useEffect(() => {
    let active = true;
    void load()
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "عملیات مصاحبه بارگذاری نشد");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);

  async function scheduleOrAssign(session: SessionOption) {
    if (TERMINAL_SESSION_STATUSES.has(session.sessionStatus)) {
      setError("مصاحبه تکمیل‌شده یا لغوشده قابل تخصیص مجدد نیست.");
      return;
    }

    const key = operationKey(session);
    const interviewerUserId = selected[key];
    if (!interviewerUserId) {
      setError("ابتدا یک مصاحبه‌گر انتخاب کنید.");
      return;
    }

    const date = scheduledDate[key];
    const time = scheduledTime[key];
    if (!date || !time) {
      setError("برای مصاحبه، تاریخ و ساعت را مشخص کنید.");
      return;
    }

    const scheduled = new Date(`${date}T${time}:00`);
    if (Number.isNaN(scheduled.getTime())) {
      setError("تاریخ یا ساعت مصاحبه معتبر نیست.");
      return;
    }
    if (scheduled.getTime() <= Date.now()) {
      setError("زمان مصاحبه باید در آینده باشد.");
      return;
    }

    const current = identity ?? (await resolveTenantIdentity());
    setBusyKey(key);
    setError(null);
    setNotice(null);

    try {
      if (session.sessionId) {
        const result = await api.POST("/v1/interviewer/assignments", {
          headers: tenantHeaders(current),
          body: {
            sessionId: session.sessionId,
            interviewerUserId,
            scheduledFor: scheduled.toISOString(),
          },
        });
        if (!result.response.ok) {
          throw new Error(apiErrorMessage(result, "به‌روزرسانی تخصیص مصاحبه‌گر ناموفق بود"));
        }
        setNotice(
          `تخصیص «${session.candidateName}» به‌روزرسانی شد؛ مصاحبه‌گر می‌تواند آن را از «مصاحبه‌های من» شروع کند.`,
        );
      } else {
        const result = await api.POST("/v1/interview-operations/technical-interviews", {
          headers: tenantHeaders(current),
          body: {
            applicationId: session.applicationId,
            interviewerUserId,
            scheduledFor: scheduled.toISOString(),
            durationMinutes: 60,
            language: "fa",
          },
        });
        if (result.error) {
          throw new Error(apiErrorMessage(result, "ساخت و زمان‌بندی مصاحبه فنی ناموفق بود"));
        }
        setNotice(
          `برای «${session.candidateName}» Session واقعی مصاحبه ساخته و به مصاحبه‌گر انتخاب‌شده تخصیص داده شد.`,
        );
      }

      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ثبت مصاحبه ناموفق بود");
    } finally {
      setBusyKey(null);
    }
  }

  const filteredSessions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return options.sessions.filter((session) => {
      if (statusFilter === "active" && TERMINAL_SESSION_STATUSES.has(session.sessionStatus)) return false;
      if (statusFilter !== "all" && statusFilter !== "active" && session.sessionStatus !== statusFilter) return false;
      if (!normalized) return true;
      return [
        session.candidateName,
        session.jobTitle,
        session.interviewerName,
        session.interviewerEmail,
        statusLabel(session.sessionStatus),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [options.sessions, query, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-.03em] text-slate-950">مصاحبه‌ها</h1>
          <p className="mt-1 text-[11px] text-slate-500">
            پرونده‌های واردشده به مرحله مصاحبه حتی اگر Session نداشته باشند اینجا نمایش داده می‌شوند؛ انتخاب مصاحبه‌گر و زمان، Session واقعی را می‌سازد.
          </p>
        </div>
        <Link
          href="/interviewer/interviews"
          className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
        >
          رفتن به «مصاحبه‌های من»
        </Link>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-800">
          {notice}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-[260px] flex-1">
            <Icon name="search" size={14} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="جست‌وجو بر اساس کاندیدا، موقعیت یا مصاحبه‌گر..."
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 ps-10 pe-3 text-[11px] outline-none focus:border-indigo-300 focus:bg-white"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="فیلتر وضعیت مصاحبه"
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[11px]"
          >
            <option value="active">مصاحبه‌های فعال</option>
            <option value="needs_scheduling">نیازمند برنامه‌ریزی</option>
            <option value="all">همه وضعیت‌ها</option>
            <option value="invited">در انتظار</option>
            <option value="scheduled">زمان‌بندی‌شده</option>
            <option value="in_progress">در حال انجام</option>
            <option value="completed">تکمیل‌شده</option>
            <option value="cancelled">لغوشده</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-start text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-[.06em] text-slate-400">
              <tr>
                <th className="px-5 py-3">کاندیدا</th>
                <th className="px-3 py-3">موقعیت شغلی</th>
                <th className="px-3 py-3">وضعیت</th>
                <th className="px-3 py-3">زمان‌بندی</th>
                <th className="px-3 py-3">مصاحبه‌گر</th>
                <th className="px-5 py-3 text-end">اقدام</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                    در حال بارگذاری عملیات مصاحبه…
                  </td>
                </tr>
              ) : (
                filteredSessions.map((session) => {
                  const key = operationKey(session);
                  const terminal = TERMINAL_SESSION_STATUSES.has(session.sessionStatus);
                  const needsScheduling = session.sessionStatus === "needs_scheduling";

                  return (
                    <tr key={key} className={needsScheduling ? "bg-amber-50/30" : undefined}>
                      <td className="px-5 py-4 font-semibold text-slate-800">{session.candidateName}</td>
                      <td className="px-3 py-4 text-slate-600">{session.jobTitle}</td>

                      <td className="px-3 py-4">
                        <span
                          className={
                            needsScheduling
                              ? "rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-800"
                              : "rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600"
                          }
                        >
                          {statusLabel(session.sessionStatus)}
                        </span>
                        {needsScheduling ? (
                          <div className="mt-1 max-w-44 text-[9px] leading-4 text-amber-700">
                            پرونده در مرحله مصاحبه است ولی Session فعال ندارد.
                          </div>
                        ) : session.assignmentStatus && !terminal ? (
                          <div className="mt-1 text-[9px] font-medium text-emerald-600">تخصیص ثبت‌شده</div>
                        ) : null}
                      </td>

                      <td className="px-3 py-4 text-slate-500">
                        {terminal ? (
                          <div>{session.scheduledFor ? formatFaDateTime(session.scheduledFor) : "زمان‌بندی نشده"}</div>
                        ) : (
                          <div className="grid min-w-[270px] grid-cols-2 gap-2">
                            <label className="text-[9px] font-medium text-slate-500">
                              تاریخ
                              <input
                                aria-label={`تاریخ مصاحبه برای ${session.candidateName}`}
                                type="date"
                                min={minDate}
                                value={scheduledDate[key] ?? ""}
                                onChange={(event) =>
                                  setScheduledDate((state) => ({ ...state, [key]: event.target.value }))
                                }
                                dir="ltr"
                                className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px]"
                              />
                            </label>

                            <label className="text-[9px] font-medium text-slate-500">
                              ساعت
                              <input
                                aria-label={`ساعت مصاحبه برای ${session.candidateName}`}
                                type="time"
                                step="300"
                                value={scheduledTime[key] ?? ""}
                                onChange={(event) =>
                                  setScheduledTime((state) => ({ ...state, [key]: event.target.value }))
                                }
                                dir="ltr"
                                className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px]"
                              />
                            </label>

                            {session.scheduledFor ? (
                              <div className="col-span-2 text-[9px] text-slate-400">
                                ثبت‌شده: {formatFaDateTime(session.scheduledFor)}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-4">
                        {terminal ? (
                          <div className="font-semibold text-slate-700">
                            {session.interviewerName || session.interviewerEmail || "بدون مصاحبه‌گر"}
                          </div>
                        ) : (
                          <div className="min-w-52">
                            <label className="sr-only" htmlFor={`interviewer-${key}`}>
                              مصاحبه‌گر برای {session.candidateName}
                            </label>
                            <select
                              id={`interviewer-${key}`}
                              value={selected[key] ?? ""}
                              onChange={(event) =>
                                setSelected((state) => ({ ...state, [key]: event.target.value }))
                              }
                              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px]"
                            >
                              <option value="">انتخاب مصاحبه‌گر</option>
                              {options.interviewers.map((interviewer) => (
                                <option key={interviewer.userId} value={interviewer.userId}>
                                  {interviewer.displayName || interviewer.email}
                                </option>
                              ))}
                            </select>

                            {session.interviewerUserId ? (
                              <div className="mt-1 text-[9px] text-emerald-600">
                                {needsScheduling ? "آخرین مصاحبه‌گر ثبت‌شده" : "مصاحبه‌گر مرحله قبل"}:{" "}
                                {session.interviewerName || session.interviewerEmail}
                              </div>
                            ) : (
                              <div className="mt-1 text-[9px] text-amber-600">مصاحبه‌گر را انتخاب کنید.</div>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="px-5 py-4 text-end">
                        {terminal ? (
                          <span className="text-[10px] text-slate-400">این مصاحبه پایان یافته است</span>
                        ) : (
                          <button
                            disabled={busyKey === key || !selected[key] || !scheduledDate[key] || !scheduledTime[key]}
                            onClick={() => void scheduleOrAssign(session)}
                            className="rounded-lg bg-slate-950 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40"
                            type="button"
                          >
                            {busyKey === key
                              ? "در حال ثبت…"
                              : needsScheduling
                                ? "ساخت Session و ارسال به مصاحبه"
                                : session.interviewerUserId
                                  ? "ذخیره تخصیص"
                                  : "تخصیص و ارسال به مصاحبه"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}

              {!loading && filteredSessions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                    {options.sessions.length
                      ? "مصاحبه فعالی با فیلترهای فعلی پیدا نشد. برای دیدن تاریخچه، «همه وضعیت‌ها» را انتخاب کنید."
                      : "هیچ پرونده‌ای در مرحله مصاحبه یا Session مصاحبه‌ای وجود ندارد."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
