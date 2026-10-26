"use client";

import type { components } from "@interview/api-client";
import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { formatFaNumber } from "../../lib/fa-numbers";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { Panel } from "../product/recruiting-ui";

type Requirement = components["schemas"]["JobSkillRequirementInputDto"];
type SavedRequirement = components["schemas"]["JobSkillRequirementDto"];

const catalogue: ReadonlyArray<Pick<Requirement, "skillKey" | "nameEn" | "nameFa" | "category">> = [
  { skillKey: "c-sharp", nameEn: "C#", nameFa: "سی‌شارپ", category: "technical" },
  { skillKey: "aspnet-core", nameEn: "ASP.NET Core", nameFa: "ای‌اس‌پی دات‌نت کور", category: "technical" },
  { skillKey: "dotnet", nameEn: ".NET", nameFa: "دات‌نت", category: "technical" },
  { skillKey: "sql-server", nameEn: "SQL Server", nameFa: "اس‌کیوال سرور", category: "technical" },
  { skillKey: "postgresql", nameEn: "PostgreSQL", nameFa: "پستگرس", category: "technical" },
  { skillKey: "redis", nameEn: "Redis", nameFa: "ردیس", category: "technical" },
  { skillKey: "microservices", nameEn: "Microservices", nameFa: "میکروسرویس", category: "technical" },
  { skillKey: "distributed-systems", nameEn: "Distributed Systems", nameFa: "سامانه‌های توزیع‌شده", category: "technical" },
  { skillKey: "docker", nameEn: "Docker", nameFa: "داکر", category: "technical" },
  { skillKey: "rabbitmq", nameEn: "RabbitMQ", nameFa: "ربیت‌ام‌کیو", category: "technical" },
  { skillKey: "ef-core", nameEn: "Entity Framework Core", nameFa: "انتیتی فریم‌ورک کور", category: "technical" },
  { skillKey: "problem-solving", nameEn: "Problem Solving", nameFa: "حل مسئله", category: "soft" },
  { skillKey: "technical-communication", nameEn: "Technical Communication", nameFa: "ارتباط فنی", category: "soft" },
];

function requirementInput(row: SavedRequirement | Requirement): Requirement {
  return {
    skillKey: row.skillKey,
    nameEn: row.nameEn,
    ...(row.nameFa ? { nameFa: row.nameFa } : {}),
    category: row.category,
    requiredLevel: row.requiredLevel,
    weight: row.weight,
    required: row.required,
    minimumEvidenceCount: row.minimumEvidenceCount,
    ...(row.rubricCriterionId ? { rubricCriterionId: row.rubricCriterionId } : {}),
  };
}

export function JobSkillRequirementsEditor({
  jobId, rubricCriteria,
}: {
  jobId: string;
  rubricCriteria: Array<{ id: string; label: string }>;
}) {
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [rows, setRows] = useState<Requirement[]>([]);
  const [selectedKey, setSelectedKey] = useState("c-sharp");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const resolved = await resolveTenantIdentity();
        const result = await api.GET("/v1/jobs/{jobId}/skill-requirements", {
          params: { path: { jobId } }, headers: tenantHeaders(resolved),
        });
        if (result.error) throw new Error(apiErrorMessage(result, "مهارت‌های شغل بارگذاری نشد."));
        if (active) {
          setIdentity(resolved);
          setRows((result.data ?? []).map(requirementInput));
        }
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "خطا در دریافت مهارت‌ها");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [jobId]);

  function changeRow(skillKey: string, patch: Partial<Requirement>) {
    setRows((previous) => previous.map((row) => row.skillKey === skillKey ? { ...row, ...patch } : row));
    setSaved(false);
  }

  function addSkill() {
    if (rows.some((row) => row.skillKey === selectedKey)) return;
    const definition = catalogue.find((item) => item.skillKey === selectedKey);
    if (!definition) return;
    setRows((current) => [...current, {
      ...definition, requiredLevel: 3, weight: 1, required: true, minimumEvidenceCount: 1,
    }]);
    setSaved(false);
  }

  async function save() {
    if (!identity) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await api.PUT("/v1/jobs/{jobId}/skill-requirements", {
        params: { path: { jobId } },
        headers: tenantHeaders(identity),
        body: { skills: rows.map(requirementInput) },
      });
      if (result.error) throw new Error(apiErrorMessage(result, "ذخیره مهارت‌ها موفق نبود."));
      setRows((result.data ?? []).map(requirementInput));
      setSaved(true);
      setMessage("مهارت‌ها ذخیره شدند؛ نسخه‌های قبلی برای ممیزی نگهداری می‌شوند.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ثبت تغییرات ناموفق بود");
      setSaved(false);
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px] outline-none focus:border-indigo-400";
  return (
    <Panel className="space-y-4 p-5">
      <div>
        <h2 className="text-[13px] font-semibold text-slate-900">مدل مهارت‌های موردنیاز شغل</h2>
        <p className="mt-2 text-[10px] leading-5 text-slate-500">
          سطح، اهمیت و حداقل شواهد هر مهارت را مشخص کنید. این تنظیم مستقل از معیارهای نمره‌دهی منتشرشده است
          و به‌تنهایی امتیاز مصاحبه را تغییر نمی‌دهد. پس از ایجاد جلسه مصاحبه، این تنظیمات قفل می‌شوند.
        </p>
      </div>

      {loading ? <div className="text-[11px] text-slate-500">در حال دریافت مهارت‌ها…</div> : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-56 flex-1 space-y-1 text-[10px] font-semibold text-slate-600">
              مهارت جدید
              <select className={field} value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>
                {catalogue.map((item) => <option key={item.skillKey} value={item.skillKey}>{item.nameFa ?? item.nameEn} ({item.nameEn})</option>)}
              </select>
            </label>
            <button type="button" onClick={addSkill} disabled={rows.some((row) => row.skillKey === selectedKey)}
              className="rounded-lg border border-indigo-200 px-4 py-2 text-[11px] font-semibold text-indigo-700 disabled:opacity-40">
              افزودن مهارت
            </button>
          </div>
          {rows.length ? <div className="space-y-3">
            {rows.map((row) => <div key={row.skillKey} className="rounded-xl border border-slate-100 p-3">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-[11px] text-slate-800">{row.nameFa ?? row.nameEn} · {row.nameEn}</strong>
                <button type="button" onClick={() => { setRows((list) => list.filter((item) => item.skillKey !== row.skillKey)); setSaved(false); }}
                  className="text-[10px] text-rose-600 hover:underline">حذف از شغل</button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <label className="space-y-1 text-[10px] text-slate-600">سطح هدف (۱ تا ۵)
                  <select className={field} value={row.requiredLevel} onChange={(event) => changeRow(row.skillKey, { requiredLevel: Number(event.target.value) })}>
                    {[1,2,3,4,5].map((level) => <option key={level} value={level}>{formatFaNumber(level)}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-[10px] text-slate-600">وزن اهمیت
                  <input className={field} dir="ltr" type="number" step="0.1" min="0.001" max="100" value={row.weight}
                    onChange={(event) => changeRow(row.skillKey, { weight: Number(event.target.value) })} />
                </label>
                <label className="space-y-1 text-[10px] text-slate-600">حداقل شواهد
                  <input className={field} dir="ltr" type="number" step="1" min="1" max="20" value={row.minimumEvidenceCount}
                    onChange={(event) => changeRow(row.skillKey, { minimumEvidenceCount: Number(event.target.value) })} />
                </label>
                <label className="flex items-center gap-2 text-[10px] text-slate-600">
                  <input type="checkbox" checked={row.required} onChange={(event) => changeRow(row.skillKey, { required: event.target.checked })} />
                  مهارت الزامی
                </label>
              </div>
              <label className="mt-3 block space-y-1 text-[10px] text-slate-600">
                پیوند با معیار ارزیابی موجود (اختیاری)
                <select className={field} value={row.rubricCriterionId ?? ""}
                  onChange={(event) => changeRow(row.skillKey, { rubricCriterionId: event.target.value || undefined })}>
                  <option value="">بدون پیوند؛ این مهارت وارد امتیاز Rubric نمی‌شود</option>
                  {rubricCriteria.map((criterion) => (
                    <option key={criterion.id} value={criterion.id}>{criterion.label}</option>
                  ))}
                </select>
              </label>
            </div>)}
          </div> : <p className="rounded-lg bg-slate-50 p-4 text-[10px] text-slate-500">هنوز مهارتی برای این شغل سطح‌بندی نشده است.</p>}

          {message ? <p role="status" className={`text-[10px] ${saved ? "text-emerald-700" : "text-rose-600"}`}>{message}</p> : null}
          <button type="button" disabled={!identity || busy} onClick={() => void save()}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-[11px] font-semibold text-white disabled:opacity-50">
            {busy ? "در حال ذخیره…" : "ذخیره نسخه مهارت‌ها"}
          </button>
        </>
      )}
    </Panel>
  );
}
