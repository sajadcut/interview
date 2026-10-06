"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { formatFaDateTime } from "../../lib/i18n";
import { formatFaDigits, formatFaNumber, formatFaPercent } from "../../lib/fa-numbers";
import { isSoftSkillCriterion } from "../../lib/rubric-criteria";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";

type Criterion={id:string;criterion_key:string;label:string;description?:string|null;weight:number;required:boolean;evidence_policy?:Record<string,unknown>};
type CriterionResult={criterionId?:string;criterionKey?:string;label?:string;score?:number|null;confidence?:number;status?:string;rationale?:string|null;evidenceIds?:string[]};
type Evidence={id:string;criterion_id?:string|null;transcript_segment_ids?:string[];summary:string;confidence?:number|null};
type Transcript={id:string;speaker:string;start_ms:number;end_ms:number;text:string};
type Evaluation={id:string;evaluator_version:string;status:string;criterion_results:CriterionResult[];recommendation?:string|null;human_review_state?:string;evidence_complete?:boolean;overall_confidence?:number|null;weighted_score?:number|null;validation_report?:{criterionCoverage?:number;requiredCriterionCoverage?:number};requires_human_review?:boolean;created_at?:string};
type ResumeClaimValidation={id:string;claimType:string;text:string;sourceReference:string;status:"supported"|"insufficient_evidence"|"contradicted"|"unverified";interviewEvidenceIds:string[];transcriptSegmentIds:string[];score?:number;confidence?:number};
type Review={
  session:{id:string;status:string;started_at?:string|null;completed_at?:string|null;interview_type:string;time_budget_minutes:number;candidate_id:string;job_id:string};
  clock:{durationSeconds:number;elapsedSeconds:number;remainingSeconds:number};
  transcript:Transcript[]; evidence:Evidence[]; evaluations:Evaluation[]; criteria:Criterion[];
  evaluationJob?:{status?:string;last_error_code?:string|null}|null;
  evaluationReconciliation?:{status?:string;errorCode?:string;message?:string};
  resumeEvidence?:Array<{id:string;evidence_type:string;source_type:string;source_reference:string;excerpt?:string|null;occurred_at?:string|null;created_at?:string}>;
  resumeClaimValidations?:ResumeClaimValidation[];
  humanReview?:{status?:string;reason_codes?:string[];human_override?:unknown;override_rationale?:string|null;created_at?:string;completed_at?:string|null}|null;
  integrity:{status:"review_recommended"|"no_observed_concern";automaticCheatingDecision:false;automaticScorePenalty:false;hiddenDurationMs:number;counts:Record<string,number>;events:Array<{id:string;sequence:number;event_type:string;duration_ms?:number|null;created_at?:string}>};
  safetyNotice:string;
};

function recommendation(value?:string|null){const x:Record<string,string>={strong_recommend:"پیشنهاد قوی برای ادامه",review:"نیازمند بررسی انسانی",not_recommended:"پیشنهاد برای عدم ادامه",insufficient_evidence:"شواهد ناکافی"};return value?x[value]??value:"هنوز نتیجه‌ای ثبت نشده";}
function resumeClaimStatus(value:ResumeClaimValidation["status"]){const x:Record<ResumeClaimValidation["status"],string>={supported:"تأییدشده با شواهد",insufficient_evidence:"تا حدی پشتیبانی‌شده / شواهد ناکافی",contradicted:"تضعیف‌شده / متناقض",unverified:"بررسی‌نشده"};return x[value];}
function resumeClaimTone(value:ResumeClaimValidation["status"]){return value==="supported"?"bg-emerald-50 text-emerald-700":value==="contradicted"?"bg-rose-50 text-rose-700":value==="insufficient_evidence"?"bg-amber-50 text-amber-800":"bg-slate-100 text-slate-600";}
function resumeClaimType(value:string){const x:Record<string,string>={skill:"مهارت",seniority:"ارشدیت",project:"پروژه",architecture:"معماری",leadership_ownership:"رهبری و مالکیت",technology:"فناوری",scale_performance:"مقیاس و کارایی",security:"امنیت",database:"پایگاه داده",cloud_devops:"ابر و دواپس",measurable_achievement:"دستاورد قابل اندازه‌گیری"};return x[value]??"ادعای رزومه";}
function evaluationStatus(data:Review,ai:Evaluation|null){if(ai)return"ارزیابی آماده";const status=data.evaluationJob?.status??data.evaluationReconciliation?.status;if(status==="failed"||status==="invalid_result")return"نیازمند بررسی";return"ارزیابی در حال پردازش";}

function timecode(ms:number){const s=Math.max(0,Math.floor(ms/1000));return formatFaDigits(`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`);}
function tone(score?:number|null){if(score==null)return"bg-slate-100 text-slate-600";if(score>=80)return"bg-emerald-50 text-emerald-700";if(score>=60)return"bg-amber-50 text-amber-800";return"bg-rose-50 text-rose-700";}

export function InterviewReview({sessionId}:{sessionId:string}){
  const [identity,setIdentity]=useState<TenantIdentity|null>(null);
  const [data,setData]=useState<Review|null>(null);
  const [error,setError]=useState<string|null>(null);
  const load=useCallback(async()=>{
    const current=identity??await resolveTenantIdentity(); if(!identity)setIdentity(current);
    const request=await api.GET("/v1/interviews/{sessionId}/review",{
      headers:tenantHeaders(current),
      params:{path:{sessionId}},
    });
    const result=request as unknown as {data?:unknown;error?:unknown;response:Response};
    if(result.response.status===401){window.location.replace("/login");return}
    if(result.error||!result.data)throw new Error(apiErrorMessage(result,"نتیجه مصاحبه بارگذاری نشد"));
    setData(result.data as Review);
  },[identity,sessionId]);
  useEffect(()=>{void load().catch(c=>setError(c instanceof Error?c.message:"نتیجه مصاحبه بارگذاری نشد"))},[load]);
  useEffect(()=>{if(!data||data.evaluations.some(x=>!x.evaluator_version.startsWith("human:")))return;const t=window.setInterval(()=>void load().catch(()=>undefined),5000);return()=>window.clearInterval(t)},[data,load]);

  const ai=useMemo(()=>data?.evaluations.find(x=>!x.evaluator_version.startsWith("human:"))??null,[data]);
  const byCriterion=useMemo(()=>{const m=new Map<string,CriterionResult>();for(const x of ai?.criterion_results??[]){if(x.criterionId)m.set(x.criterionId,x);if(x.criterionKey)m.set(x.criterionKey,x)}return m},[ai]);
  const rows=useMemo(()=>(data?.criteria??[]).map(criterion=>({criterion,result:byCriterion.get(criterion.id)??byCriterion.get(criterion.criterion_key),soft:isSoftSkillCriterion({criterionKey:criterion.criterion_key,label:criterion.label,...(criterion.evidence_policy?{evidencePolicy:criterion.evidence_policy}:{})})})),[data?.criteria,byCriterion]);
  const technical=rows.filter(x=>!x.soft),soft=rows.filter(x=>x.soft);
  const evidenceById=useMemo(()=>new Map((data?.evidence??[]).map(x=>[x.id,x])),[data?.evidence]);
  const transcriptById=useMemo(()=>new Map((data?.transcript??[]).map(x=>[x.id,x])),[data?.transcript]);
  const strengths=rows.filter(x=>(x.result?.score??-1)>=80),gaps=rows.filter(x=>x.result?.score!=null&&(x.result.score??100)<60);

  if(error)return <div className="rounded-2xl border border-rose-100 bg-rose-50 p-5 text-sm text-rose-700">{error}</div>;
  if(!data)return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">در حال بارگذاری نتیجه مصاحبه…</div>;

  return <div className="mx-auto max-w-[1280px] space-y-5">
    <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-[10px] font-semibold text-indigo-600">نتیجه مصاحبه · تصمیم‌یار انسانی</div><h1 className="mt-1 text-2xl font-semibold text-slate-950">امتیازنامه و شواهد مصاحبه</h1><p className="mt-2 text-[11px] leading-5 text-slate-500">امتیازها فقط از چارچوب ارزیابی نسخه‌دار و شواهد مصاحبه محاسبه می‌شوند. گزارش یکپارچگی جداست و هیچ سیگنال آن به‌تنهایی اثبات تقلب یا دلیل رد خودکار نیست.</p></div><a href="/app/interviews" className="rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-semibold text-slate-700">بازگشت به مصاحبه‌ها</a></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><Metric label="وضعیت جلسه" value={data.session.status==="completed"?"تکمیل‌شده":data.session.status}/><Metric label="وضعیت ارزیابی" value={evaluationStatus(data,ai)}/><Metric label="پوشش شواهد" value={ai?.validation_report?.criterionCoverage==null?"—":formatFaPercent(ai.validation_report.criterionCoverage*100)}/><Metric label="امتیاز کلی" value={ai?.weighted_score==null?"—":formatFaNumber(ai.weighted_score)}/><Metric label="اطمینان" value={ai?.overall_confidence==null?"—":formatFaPercent(ai.overall_confidence*100)}/><Metric label="پیشنهاد" value={recommendation(ai?.recommendation)}/></div>
    </header>

    {!ai?<section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900">ارزیابی هنوز نهایی نشده است. پردازش پس از تکمیل رسمی جلسه انجام می‌شود و تصمیم نهایی همچنان با تیم استخدام است.{data.evaluationReconciliation?.errorCode?<span> کد پیگیری: {data.evaluationReconciliation.errorCode}</span>:null}</section>:null}

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.75fr)]">
      <div className="space-y-5">
        <CriterionSection title="مهارت‌های فنی" rows={technical} evidenceById={evidenceById} transcriptById={transcriptById}/>
        <CriterionSection title="مهارت‌های نرم قابل مشاهده و مرتبط با شغل" rows={soft} evidenceById={evidenceById} transcriptById={transcriptById} empty="در چارچوب ارزیابی این مصاحبه معیار مهارت نرم تعریف نشده است؛ سیستم از لحن، چهره، لهجه یا زبان بدن امتیاز نرم تولید نمی‌کند."/>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-semibold text-slate-900">نقاط قوت و شکاف‌ها</h2><div className="mt-4 grid gap-4 md:grid-cols-2"><div><h3 className="text-xs font-semibold text-emerald-700">نقاط قوت مبتنی بر شواهد</h3>{strengths.length?strengths.map(x=><div key={x.criterion.id} className="mt-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">{x.criterion.label} · {formatFaNumber(x.result?.score??0)}</div>):<p className="mt-2 text-xs text-slate-400">موردی با آستانه فعلی ثبت نشده است.</p>}</div><div><h3 className="text-xs font-semibold text-rose-700">شکاف‌های نیازمند بررسی</h3>{gaps.length?gaps.map(x=><div key={x.criterion.id} className="mt-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-900">{x.criterion.label} · {formatFaNumber(x.result?.score??0)}</div>):<p className="mt-2 text-xs text-slate-400">شکاف امتیازی زیر آستانه فعلی ثبت نشده است.</p>}</div></div></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-semibold text-slate-900">اعتبارسنجی ادعاهای رزومه</h2><p className="mt-1 text-[10px] leading-5 text-slate-500">ادعای رزومه به‌خودی‌خود شواهد مثبت نیست. «تأییدشده» فقط زمانی نمایش داده می‌شود که پاسخ مصاحبه به همان ادعا پیوند خورده و ارزیابی نهایی نیز همان شواهد را استناد کرده باشد.</p><div className="mt-4 space-y-3">{(data.resumeClaimValidations??[]).length?(data.resumeClaimValidations??[]).map(x=>{const anchors=x.transcriptSegmentIds.map(id=>transcriptById.get(id)).filter(Boolean) as Transcript[];return <div key={x.id} className="rounded-xl border border-slate-100 p-3 text-xs"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-[9px] font-semibold text-indigo-600">{resumeClaimType(x.claimType)}</div><div className="mt-1 font-semibold leading-5 text-slate-800">{x.text}</div></div><span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${resumeClaimTone(x.status)}`}>{resumeClaimStatus(x.status)}</span></div>{anchors.length?<div className="mt-3 flex flex-wrap gap-2">{anchors.map(a=><span key={a.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[9px] text-indigo-600">{timecode(a.start_ms)} · شواهد متن مصاحبه</span>)}</div>:<div className="mt-2 text-[9px] text-slate-400">هنوز شواهد مصاحبه‌ای قابل استناد برای این ادعا ثبت نشده است.</div>}{x.score!==undefined?<div className="mt-2 text-[9px] text-slate-500">امتیاز مرتبط: {formatFaNumber(x.score)}{x.confidence!==undefined?` · اطمینان ${formatFaPercent(x.confidence*100)}`:""}</div>:null}</div>}):<div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-500">ادعای رزومه قابل مقایسه برای این کاندیدا ثبت نشده است.</div>}</div></section>
      </div>

      <aside className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-slate-900">یکپارچگی جلسه</h2><span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${data.integrity.status==="review_recommended"?"bg-amber-100 text-amber-800":"bg-emerald-50 text-emerald-700"}`}>{data.integrity.status==="review_recommended"?"نیازمند بررسی":"بدون نگرانی مشاهده‌شده"}</span></div><p className="mt-2 text-[10px] leading-5 text-slate-500">فقط رخدادهای قابل مشاهده مرورگر ثبت شده‌اند. استفاده از دستگاه دوم یا ابزار AI خارج از مرورگر با قطعیت قابل تشخیص نیست.</p><div className="mt-4 space-y-2 text-xs"><IntegrityRow label="خروج از صفحه" value={data.integrity.counts.visibility_hidden??0}/><IntegrityRow label="مدت خارج از صفحه" value={`${formatFaNumber(Math.round(data.integrity.hiddenDurationMs/1000))} ثانیه`}/><IntegrityRow label="از دست رفتن فوکوس" value={data.integrity.counts.window_blur??0}/><IntegrityRow label="Paste بزرگ" value={data.integrity.counts.large_paste??0}/><IntegrityRow label="اتصال مجدد" value={data.integrity.counts.reconnect??0}/></div><div className="mt-4 rounded-xl bg-slate-50 p-3 text-[10px] leading-5 text-slate-600">هیچ‌کدام از این موارد امتیاز فنی یا مهارت نرم را خودکار کاهش نمی‌دهند و باعث رد خودکار نمی‌شوند.</div></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-semibold text-slate-900">بررسی انسانی</h2>{data.humanReview?<div className="mt-3 space-y-2 text-xs text-slate-600"><div>وضعیت: <strong>{data.humanReview.status}</strong></div>{data.humanReview.human_override!=null?<div>اعمال تصمیم انسانی: <strong>ثبت شده</strong></div>:null}{data.humanReview.override_rationale?<div className="rounded-xl bg-indigo-50 p-3 text-indigo-900"><div className="text-[9px] font-semibold">دلیل تصمیم/بازنگری انسانی</div><div className="mt-1">{data.humanReview.override_rationale}</div></div>:null}{data.humanReview.completed_at?<div className="text-[10px] text-slate-400">{formatFaDateTime(data.humanReview.completed_at)}</div>:null}</div>:<p className="mt-3 text-xs leading-5 text-slate-500">هنوز بررسی انسانی ثبت نشده است. تصمیم نهایی استخدام همچنان انسانی است.</p>}</section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-semibold text-slate-900">لحظه‌های کلیدی</h2><div className="mt-3 max-h-[480px] space-y-2 overflow-y-auto">{data.evidence.map(x=>{const a=x.transcript_segment_ids?.[0]?transcriptById.get(x.transcript_segment_ids[0]):undefined;return <div key={x.id} className="rounded-xl border border-slate-100 p-3 text-xs leading-5 text-slate-700"><div>{x.summary}</div>{a?<div className="mt-1 text-[9px] text-indigo-600">{timecode(a.start_ms)} · {a.speaker==="candidate"?"کاندیدا":"مصاحبه‌گر"}</div>:null}</div>})}</div></section>
      </aside>
    </div>
  </div>;
}

function Metric({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-slate-50 p-3"><div className="text-[9px] text-slate-400">{label}</div><div className="mt-1 text-xs font-semibold text-slate-800">{value}</div></div>}
function IntegrityRow({label,value}:{label:string;value:string|number}){return <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"><span className="text-slate-500">{label}</span><strong className="text-slate-800">{typeof value==="number"?formatFaNumber(value):value}</strong></div>}
function CriterionSection({title,rows,evidenceById,transcriptById,empty}:{title:string;rows:Array<{criterion:Criterion;result:CriterionResult|undefined;soft:boolean}>;evidenceById:Map<string,Evidence>;transcriptById:Map<string,Transcript>;empty?:string}){
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-semibold text-slate-900">{title}</h2>{rows.length?<div className="mt-4 space-y-3">{rows.map(({criterion,result})=>{const ev=(result?.evidenceIds??[]).map(id=>evidenceById.get(id)).filter(Boolean) as Evidence[];return <div key={criterion.id} className="rounded-xl border border-slate-100 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-semibold text-slate-900">{criterion.label}</div><div className="mt-1 text-[9px] text-slate-400">وزن {formatFaNumber(Number(criterion.weight))}</div></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(result?.score)}`}>{result?.score==null?"شواهد ناکافی":formatFaNumber(result.score)}</span></div>{result?.rationale?<p className="mt-3 text-[11px] leading-5 text-slate-600">{result.rationale}</p>:null}{ev.length?<div className="mt-3 space-y-2">{ev.map(x=>{const id=x.transcript_segment_ids?.[0];const a=id?transcriptById.get(id):undefined;return <div key={x.id} className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-5 text-slate-600">{x.summary}{a?<span className="ms-2 font-semibold text-indigo-600">{timecode(a.start_ms)}</span>:null}</div>})}</div>:null}</div>})}</div>:<p className="mt-3 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-500">{empty??"معیاری ثبت نشده است."}</p>}</section>
}
