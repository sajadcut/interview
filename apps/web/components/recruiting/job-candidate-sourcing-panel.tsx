"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { formatFaDigits, formatFaNumber, formatFaPercent } from "../../lib/fa-numbers";
import { faDomainLabel } from "../../lib/i18n";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { useInternalAccess } from "../product/internal-access";
import { Panel, Pill } from "../product/recruiting-ui";
import { CandidateResumeIntakePanel } from "./candidate-resume-intake-panel";

type TalentMatch = components["schemas"]["JobTalentMatchDto"];
type TalentAnalysis = components["schemas"]["JobTalentAnalysisStatusDto"];
type SourceCapability = components["schemas"]["SourcingSourceCapabilityDto"];
type FinderPlan = components["schemas"]["CandidateFinderPlanStatusDto"];
type FinderResultAnalysis = components["schemas"]["CandidateFinderResultAnalysisStatusDto"];
type SourcingRun = components["schemas"]["SourcingRunExecutionDto"];

type Tab = "suggestions" | "resume" | "finder";

const terminalAiStatuses = new Set(["succeeded", "failed", "dead_letter", "cancelled"]);

function providerLabel(value?: string) {
  if (value === "people_data_labs") return "People Data Labs";
  if (value === "coresignal") return "Coresignal";
  if (value === "greenhouse") return "Greenhouse";
  if (value === "lever") return "Lever";
  return value || "منبع تأییدشده";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function JobCandidateSourcingPanel({
  jobId,
  jobTitle,
  rubricPublished,
  onApplicationChanged,
}: {
  jobId: string;
  jobTitle: string;
  rubricPublished: boolean;
  onApplicationChanged: () => Promise<void>;
}) {
  const access = useInternalAccess();
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [tab, setTab] = useState<Tab>("suggestions");
  const [matches, setMatches] = useState<TalentMatch[]>([]);
  const [capabilities, setCapabilities] = useState<SourceCapability[]>([]);
  const [analysisJobId, setAnalysisJobId] = useState<string>();
  const [analysis, setAnalysis] = useState<TalentAnalysis>();
  const [planJobId, setPlanJobId] = useState<string>();
  const [plan, setPlan] = useState<FinderPlan>();
  const [runs, setRuns] = useState<SourcingRun[]>([]);
  const [finderAnalysisJobId, setFinderAnalysisJobId] = useState<string>();
  const [finderAnalysis, setFinderAnalysis] = useState<FinderResultAnalysis>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();

  const configuredExternal = useMemo(
    () => capabilities.filter((source) => source.configured && source.sourceType !== "internal_talent_pool"),
    [capabilities],
  );

  const analysisByCandidate = useMemo(
    () => new Map((analysis?.matches ?? []).map((item) => [item.candidateId, item])),
    [analysis?.matches],
  );

  const finderAnalysisByDiscovered = useMemo(
    () => new Map((finderAnalysis?.matches ?? []).map((item) => [item.discoveredCandidateId, item])),
    [finderAnalysis?.matches],
  );

  const discoveredResults = useMemo(
    () => runs.flatMap((run) =>
      (run.results ?? []).map((result) => ({
        ...result,
        runId: run.id,
        providerKey: run.providerKey,
      })),
    ),
    [runs],
  );

  async function loadBase(current: TenantIdentity) {
    const headers = tenantHeaders(current);
    const [matchesResult, capabilityResult] = await Promise.all([
      api.GET("/v1/jobs/{jobId}/talent-matches", {
        params: { path: { jobId }, query: { limit: 25 } },
        headers,
      }),
      api.GET("/v1/sourcing/sources", { headers }),
    ]);
    if (matchesResult.error) {
      throw new Error(apiErrorMessage(matchesResult, "پیشنهادهای Talent Pool بارگذاری نشد"));
    }
    if (capabilityResult.error) {
      throw new Error(apiErrorMessage(capabilityResult, "وضعیت منابع کاندیدیابی بارگذاری نشد"));
    }
    const nextMatches = matchesResult.data ?? [];
    setMatches(nextMatches);
    setCapabilities(capabilityResult.data ?? []);

    if (nextMatches.length > 0 && access.can("sourcing.run")) {
      const start = await api.POST("/v1/jobs/{jobId}/talent-matches/analysis", {
        params: { path: { jobId } },
        headers,
      });
      if (!start.error && start.data?.analysisJobId) {
        setAnalysisJobId(start.data.analysisJobId);
      }
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const current = await resolveTenantIdentity();
        if (!active) return;
        setIdentity(current);
        await loadBase(current);
      } catch (cause) {
        if (active) setMessage(cause instanceof Error ? cause.message : "تأمین کاندیدا بارگذاری نشد");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [jobId]);

  useEffect(() => {
    if (!identity || !analysisJobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await api.GET("/v1/sourcing/talent-analysis/{analysisJobId}", {
        params: { path: { analysisJobId } },
        headers: tenantHeaders(identity),
      });
      if (!active) return;
      if (result.error || !result.data) {
        setMessage(apiErrorMessage(result, "تحلیل هوش مصنوعی پیشنهادهای داخلی دریافت نشد"));
        return;
      }
      setAnalysis(result.data);
      if (!terminalAiStatuses.has(result.data.status)) {
        timer = setTimeout(() => void poll(), 1800);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [analysisJobId, identity]);

  useEffect(() => {
    if (!identity || !planJobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await api.GET("/v1/jobs/{jobId}/candidate-finder/{planJobId}", {
        params: { path: { jobId, planJobId } },
        headers: tenantHeaders(identity),
      });
      if (!active) return;
      if (result.error || !result.data) {
        setMessage(apiErrorMessage(result, "برنامه کاندیدیاب دریافت نشد"));
        return;
      }
      setPlan(result.data);
      if (!terminalAiStatuses.has(result.data.status)) {
        timer = setTimeout(() => void poll(), 1800);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [identity, jobId, planJobId]);

  useEffect(() => {
    if (!identity || !finderAnalysisJobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await api.GET("/v1/sourcing/candidate-finder-analysis/{analysisJobId}", {
        params: { path: { analysisJobId: finderAnalysisJobId } },
        headers: tenantHeaders(identity),
      });
      if (!active) return;
      if (result.error || !result.data) {
        setMessage(apiErrorMessage(result, "تحلیل نتایج کاندیدیاب دریافت نشد"));
        return;
      }
      setFinderAnalysis(result.data);
      if (!terminalAiStatuses.has(result.data.status)) {
        timer = setTimeout(() => void poll(), 1800);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [finderAnalysisJobId, identity]);

  async function addInternalCandidate(match: TalentMatch) {
    if (!identity || match.applicationId || !rubricPublished) return;
    setBusy(`internal:${match.candidateId}`);
    setMessage(undefined);
    try {
      const result = await api.POST(
        "/v1/candidate-intake/candidates/{candidateId}/job-matches/{jobId}/apply",
        {
          params: { path: { candidateId: match.candidateId, jobId } },
          headers: tenantHeaders(identity),
        },
      );
      if (result.error || !result.data) {
        throw new Error(apiErrorMessage(result, "افزودن کاندید به این موقعیت ناموفق بود"));
      }
      const application = result.data;
      setMatches((current) => current.map((item) =>
        item.candidateId === match.candidateId
          ? { ...item, applicationId: application.applicationId }
          : item,
      ));
      setMessage(`${match.displayName} به فرآیند استخدام این موقعیت اضافه شد.`);
      await onApplicationChanged();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "افزودن کاندید ناموفق بود");
    } finally {
      setBusy(undefined);
    }
  }

  async function startFinder() {
    if (!identity || !access.can("sourcing.run")) return;
    if (configuredExternal.length === 0) {
      setMessage("هیچ ATS یا منبع بیرونی تأییدشده‌ای برای سازمان تنظیم نشده است.");
      return;
    }
    setBusy("finder-plan");
    setMessage(undefined);
    setRuns([]);
    setPlan(undefined);
    setFinderAnalysis(undefined);
    setFinderAnalysisJobId(undefined);
    try {
      const result = await api.POST("/v1/jobs/{jobId}/candidate-finder", {
        params: { path: { jobId } },
        headers: tenantHeaders(identity),
      });
      if (result.error || !result.data) {
        throw new Error(apiErrorMessage(result, "ساخت برنامه کاندیدیاب ناموفق بود"));
      }
      setPlanJobId(result.data.planJobId);
      setMessage("هوش مصنوعی در حال ساخت query و tool-callهای کاندیدیاب است.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "راه‌اندازی کاندیدیاب ناموفق بود");
    } finally {
      setBusy(undefined);
    }
  }

  async function executeFinder() {
    if (!identity || !planJobId || !plan?.toolCalls?.length) return;
    const tools = plan.toolCalls
      .map((call) => providerLabel(call.providerKey))
      .filter((value, index, all) => all.indexOf(value) === index)
      .join("، ");
    const approved = window.confirm(
      `جستجو برای «${jobTitle}» به منابع تأییدشده زیر ارسال می‌شود:\n${tools}\n\nاجرای جستجوی بیرونی را تأیید می‌کنید؟`,
    );
    if (!approved) return;

    setBusy("finder-execute");
    setMessage(undefined);
    try {
      const result = await api.POST("/v1/jobs/{jobId}/candidate-finder/{planJobId}/execute", {
        params: { path: { jobId, planJobId } },
        headers: tenantHeaders(identity),
        body: { approvalConfirmed: true },
      });
      if (result.error || !result.data) {
        throw new Error(apiErrorMessage(result, "اجرای ابزارهای کاندیدیاب ناموفق بود"));
      }
      const execution = result.data;
      setRuns(execution.runs ?? []);
      if (execution.analysisJobId) setFinderAnalysisJobId(execution.analysisJobId);
      setMessage(`کاندیدیاب اجرا شد و ${formatFaNumber((execution.runs ?? []).reduce((sum, run) => sum + (run.resultCount ?? 0), 0))} نتیجه بازیابی شد.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "اجرای کاندیدیاب ناموفق بود");
    } finally {
      setBusy(undefined);
    }
  }

  async function acceptDiscovered(discoveredCandidateId: string, displayName: string) {
    if (!identity || !rubricPublished) return;
    setBusy(`external:${discoveredCandidateId}`);
    setMessage(undefined);
    try {
      const result = await api.POST("/v1/sourcing/discovered/{discoveredCandidateId}/accept", {
        params: { path: { discoveredCandidateId } },
        headers: tenantHeaders(identity),
      });
      if (result.error || !result.data) {
        throw new Error(apiErrorMessage(result, "ورود کاندید کشف‌شده به فرآیند ناموفق بود"));
      }
      const accepted = result.data;
      setRuns((current) => current.map((run) => ({
        ...run,
        results: (run.results ?? []).map((candidate) =>
          candidate.id === discoveredCandidateId
            ? { ...candidate, candidateId: accepted.candidateId, reviewState: "accepted", preInterviewMatchScore: accepted.preInterviewMatchScore }
            : candidate,
        ),
      })));
      setMessage(`${displayName} با تأیید HR وارد Talent Pool و فرآیند این موقعیت شد.`);
      await onApplicationChanged();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "ورود کاندید کشف‌شده ناموفق بود");
    } finally {
      setBusy(undefined);
    }
  }

  if (loading) {
    return <Panel className="p-5 text-[10px] text-slate-500">در حال بررسی Talent Pool و منابع کاندیدیابی…</Panel>;
  }

  const tabs: Array<{ key: Tab; label: string; hint: string }> = [
    { key: "suggestions", label: "پیشنهادهای موجود", hint: `${formatFaNumber(matches.length)} کاندید` },
    { key: "resume", label: "افزودن رزومه", hint: "PDF / DOCX" },
    { key: "finder", label: "کاندیدیاب", hint: "فراخوان ابزار هوش مصنوعی" },
  ];

  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-slate-100 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold text-indigo-600">تأمین کاندیدا برای این موقعیت</div>
            <h2 className="mt-1 text-[16px] font-semibold text-slate-950">{jobTitle}</h2>
            <p className="mt-1 text-[9px] leading-5 text-slate-500">
              ابتدا رزومه‌های موجود سازمان بررسی می‌شوند؛ در صورت نیاز رزومه جدید اضافه کنید یا کاندیدیاب را روی منابع متصل‌شده اجرا کنید.
            </p>
          </div>
          {analysisJobId ? (
            <Pill tone={analysis?.status === "succeeded" ? "green" : "blue"}>
              تحلیل هوش مصنوعی: {analysis?.status === "succeeded" ? "آماده" : analysis?.status === "dead_letter" ? "ناموفق" : "در حال پردازش"}
            </Pill>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`rounded-xl border px-3 py-2 text-start transition ${
                tab === item.key
                  ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <div className="text-[10px] font-semibold">{item.label}</div>
              <div className="mt-0.5 text-[8px] opacity-70">{item.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {message ? (
        <div role="status" aria-live="polite" className="mx-5 mt-4 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-[9px] text-indigo-800">
          {message}
        </div>
      ) : null}

      {tab === "suggestions" ? (
        <div className="p-5">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold text-slate-800">بهترین تطبیق‌های Talent Pool</div>
              <div className="mt-1 text-[8px] text-slate-400">امتیاز از محاسبه قطعی و شواهد به‌دست می‌آید؛ هوش مصنوعی فقط دلیل و شکاف‌های قابل بررسی را توضیح می‌دهد.</div>
            </div>
            <Link href="/app/talent" className="text-[9px] font-semibold text-indigo-600">مشاهده بانک استعدادها</Link>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {matches.slice(0, 8).map((match) => {
              const ai = analysisByCandidate.get(match.candidateId);
              return (
                <div key={match.candidateId} className="rounded-2xl border border-slate-100 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={`/app/candidates/${match.candidateId}`} className="text-[11px] font-semibold text-slate-900 hover:text-indigo-600">
                        {match.displayName}
                      </Link>
                      <div className="mt-1 text-[8px] text-slate-400">
                        {[match.currentRole, match.currentCompany].filter(Boolean).join(" · ") || "پروفایل سازمانی"}
                      </div>
                    </div>
                    <div className="rounded-xl bg-indigo-50 px-3 py-2 text-center">
                      <div className="text-[8px] text-indigo-500">تطبیق</div>
                      <div className="text-[13px] font-semibold text-indigo-700">{formatFaPercent(match.matchScore)}</div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-emerald-50 p-2.5 text-[8px] leading-4 text-emerald-800">
                      <strong>منطبق:</strong> {match.matchedRequirements.length ? match.matchedRequirements.join("، ") : "شاهد صریح کافی پیدا نشد"}
                    </div>
                    <div className="rounded-lg bg-amber-50 p-2.5 text-[8px] leading-4 text-amber-800">
                      <strong>شکاف Must-have:</strong> {match.missingMustHaveRequirements.length ? match.missingMustHaveRequirements.join("، ") : "موردی نیست"}
                    </div>
                  </div>

                  {ai ? (
                    <div className="mt-3 rounded-xl bg-violet-50 p-3">
                      <div className="text-[8px] font-semibold text-violet-700">تحلیل هوش مصنوعی · اطمینان {formatFaPercent(ai.confidence * 100)}</div>
                      <p className="mt-1 text-[9px] leading-5 text-slate-700">{formatFaDigits(ai.fitSummary)}</p>
                    </div>
                  ) : null}

                  <div className="mt-3 flex justify-end">
                    {match.applicationId ? (
                      <span className="rounded-lg bg-emerald-50 px-3 py-2 text-[9px] font-semibold text-emerald-700">در فرآیند این موقعیت</span>
                    ) : (
                      <button
                        type="button"
                        disabled={!rubricPublished || busy === `internal:${match.candidateId}` || !access.can("candidate.move_stage")}
                        onClick={() => void addInternalCandidate(match)}
                        className="rounded-lg bg-slate-950 px-3 py-2 text-[9px] font-semibold text-white disabled:opacity-40"
                      >
                        {busy === `internal:${match.candidateId}` ? "در حال افزودن…" : "افزودن به فرآیند"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {matches.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center">
              <div className="text-[10px] font-semibold text-slate-600">کاندید مناسبی در Talent Pool موجود نیست.</div>
              <div className="mt-3 flex justify-center gap-2">
                <button type="button" onClick={() => setTab("resume")} className="rounded-lg border border-slate-200 px-3 py-2 text-[9px]">افزودن رزومه</button>
                <button type="button" onClick={() => setTab("finder")} className="rounded-lg bg-indigo-600 px-3 py-2 text-[9px] font-semibold text-white">کاندیدیاب</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "resume" ? (
        <div className="p-4">
          <CandidateResumeIntakePanel
            targetJobId={jobId}
            targetJobTitle={jobTitle}
            onCandidateReady={onApplicationChanged}
          />
        </div>
      ) : null}

      {tab === "finder" ? (
        <div className="p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              <div className="text-[11px] font-semibold text-slate-800">کاندیدیاب هوشمند</div>
              <p className="mt-1 text-[9px] leading-5 text-slate-500">
                هوش مصنوعی بر اساس Job و Requirementها query می‌سازد و فقط Adapterهای تأییدشده و متصل سازمان را به‌صورت tool call پیشنهاد می‌کند. scraping پنهان انجام نمی‌شود.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {configuredExternal.map((source) => (
                  <span key={`${source.sourceType}:${source.providerKey ?? ""}`} className="rounded-full bg-emerald-50 px-2.5 py-1 text-[8px] font-semibold text-emerald-700">
                    {providerLabel(source.providerKey)} · متصل
                  </span>
                ))}
                {configuredExternal.length === 0 ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[8px] font-semibold text-amber-700">منبع بیرونی متصل نیست</span>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!access.can("sourcing.run") || configuredExternal.length === 0 || busy === "finder-plan"}
                  onClick={() => void startFinder()}
                  className="rounded-lg bg-indigo-600 px-4 py-2.5 text-[10px] font-semibold text-white disabled:opacity-40"
                >
                  {busy === "finder-plan" ? "در حال ساخت برنامه…" : "اجرای کاندیدیاب"}
                </button>
                {configuredExternal.length === 0 ? (
                  <Link href="/app/integrations" className="rounded-lg border border-slate-200 px-3 py-2.5 text-[9px] font-semibold text-slate-600">
                    تنظیم اتصال‌های مجاز
                  </Link>
                ) : null}
              </div>

              {plan ? (
                <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[9px] font-semibold text-violet-700">برنامه هوش مصنوعی</div>
                    <Pill tone={plan.status === "succeeded" ? "green" : "blue"}>{faDomainLabel(plan.status)}</Pill>
                  </div>
                  {plan.rationale ? <p className="mt-2 text-[9px] leading-5 text-slate-700">{plan.rationale}</p> : null}
                  <div className="mt-3 space-y-2">
                    {(plan.toolCalls ?? []).map((call, index) => (
                      <div key={`${call.providerKey}:${index}`} className="rounded-lg bg-white p-3">
                        <div className="text-[8px] font-semibold text-slate-700">
                          ابزار {formatFaNumber(index + 1)} · {providerLabel(call.providerKey)} · {formatFaNumber(call.limit)} نتیجه
                        </div>
                        <div className="mt-1 text-[8px] leading-4 text-slate-500">{call.query}</div>
                      </div>
                    ))}
                  </div>
                  {plan.status === "succeeded" && (plan.toolCalls?.length ?? 0) > 0 ? (
                    <button
                      type="button"
                      disabled={busy === "finder-execute"}
                      onClick={() => void executeFinder()}
                      className="mt-3 rounded-lg bg-slate-950 px-3 py-2 text-[9px] font-semibold text-white disabled:opacity-40"
                    >
                      {busy === "finder-execute" ? "در حال اجرای ابزارها…" : "تأیید HR و اجرای Tool Callها"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="text-[9px] font-semibold text-slate-700">مرزهای کاندیدیاب</div>
              <div className="mt-2 space-y-2 text-[8px] leading-4 text-slate-500">
                <div>• فقط Providerهای configured و approved اجرا می‌شوند.</div>
                <div>• Retrieval score امتیاز استخدام نیست.</div>
                <div>• نتیجه اینترنتی ابتدا Discovered Candidate است.</div>
                <div>• ورود به Talent Pool و Application فقط با تأیید HR انجام می‌شود.</div>
              </div>
            </div>
          </div>

          {discoveredResults.length ? (
            <div className="mt-5">
              <h3 className="text-[11px] font-semibold text-slate-800">نتایج کشف‌شده</h3>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {discoveredResults.map((candidate) => {
                  const profile = record(candidate.profileSnapshot);
                  const provenance = record(candidate.sourceProvenance);
                  const displayName = typeof profile.displayName === "string" ? profile.displayName : "کاندید کشف‌شده";
                  const currentRole = typeof profile.currentRole === "string" ? profile.currentRole : undefined;
                  const currentCompany = typeof profile.currentCompany === "string" ? profile.currentCompany : undefined;
                  const sourceUrl = typeof provenance.sourceUrl === "string" ? provenance.sourceUrl : undefined;
                  const provider = typeof provenance.providerKey === "string" ? provenance.providerKey : candidate.providerKey;
                  const ai = finderAnalysisByDiscovered.get(candidate.id);
                  return (
                    <div key={candidate.id} className="rounded-2xl border border-slate-100 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-semibold text-slate-900">{displayName}</div>
                          <div className="mt-1 text-[8px] text-slate-400">{[currentRole, currentCompany].filter(Boolean).join(" · ") || "پروفایل بیرونی"}</div>
                        </div>
                        <Pill tone="blue">{providerLabel(provider)}</Pill>
                      </div>
                      {ai ? (
                        <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/60 p-3">
                          <div className="text-[8px] font-semibold text-violet-700">
                            تحلیل هوش مصنوعی · اطمینان {formatFaPercent(ai.confidence * 100)}
                          </div>
                          <p className="mt-1 text-[9px] leading-5 text-slate-700">{formatFaDigits(ai.fitSummary)}</p>
                          {ai.strengths.length ? (
                            <div className="mt-2 text-[8px] text-emerald-700">نقاط قوت: {formatFaDigits(ai.strengths.join(" · "))}</div>
                          ) : null}
                          {ai.gaps.length ? (
                            <div className="mt-1 text-[8px] text-amber-700">شکاف‌ها: {formatFaDigits(ai.gaps.join(" · "))}</div>
                          ) : null}
                        </div>
                      ) : finderAnalysisJobId ? (
                        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-[8px] text-slate-500">
                          تحلیل هوش مصنوعی این نتیجه در حال آماده‌سازی است…
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[8px] text-slate-500">
                          سیگنال بازیابی: {candidate.retrievalScore !== undefined ? formatFaPercent(candidate.retrievalScore * 100) : "—"}
                          {candidate.preInterviewMatchScore !== undefined ? ` · تطبیق شواهد: ${formatFaPercent(candidate.preInterviewMatchScore)}` : ""}
                        </div>
                        <div className="flex gap-2">
                          {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[8px] font-semibold text-slate-600">مشاهده منبع</a> : null}
                          {candidate.reviewState === "accepted" ? (
                            <span className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[8px] font-semibold text-emerald-700">تأیید و وارد شد</span>
                          ) : (
                            <button
                              type="button"
                              disabled={!rubricPublished || busy === `external:${candidate.id}` || !access.can("candidate.move_stage")}
                              onClick={() => void acceptDiscovered(candidate.id, displayName)}
                              className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-[8px] font-semibold text-white disabled:opacity-40"
                            >
                              {busy === `external:${candidate.id}` ? "در حال ورود…" : "تأیید HR و افزودن به فرآیند"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!rubricPublished ? (
        <div className="border-t border-amber-100 bg-amber-50 px-5 py-3 text-[8px] text-amber-800">
          برای ساخت Application از پیشنهادهای داخلی، رزومه جدید یا نتایج کاندیدیاب ابتدا چارچوب ارزیابی این Job را منتشر کنید.
        </div>
      ) : null}
    </Panel>
  );
}
