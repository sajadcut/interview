"use client";

import type { components } from "@interview/api-client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { faDomainLabel, formatFaDateTime } from "../../lib/i18n";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { BulkActionBar, ConfirmDialog, InlineFeedback, SelectionCheckbox } from "../product/collection-management";
import { Icon } from "../product/icon";
import { useInternalAccess } from "../product/internal-access";
import { Panel, Pill } from "../product/recruiting-ui";

type AutomationWorkspaceData = components["schemas"]["AutomationWorkspaceResponseDto"];
type AutomationRule = components["schemas"]["AutomationRuleResponseDto"];
type AutomationRun = components["schemas"]["AutomationRunResponseDto"];
type IntegrationRow = components["schemas"]["IntegrationConnectionResponseDto"];
type SettingsData = components["schemas"]["OrganizationSettingsResponseDto"];
type SearchRow = components["schemas"]["ProductSearchResultDto"];
type AuditRow = components["schemas"]["ProductAuditEventDto"];

function useIdentity() {
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void resolveTenantIdentity()
      .then((value) => {
        if (active) setIdentity(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "اطلاعات سازمان در دسترس نیست");
      });
    return () => {
      active = false;
    };
  }, []);
  return { identity, error };
}

export function AutomationsWorkspace() {
  const { identity, error } = useIdentity();
  const access = useInternalAccess();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    triggerType: "application.stage_changed",
    actionType: "notification.create",
    approvalRequired: true,
  });

  async function load(current: TenantIdentity) {
    const result = await api.GET("/v1/automations", { headers: tenantHeaders(current) });
    if (!result.response.ok || !result.data) throw new Error(apiErrorMessage(result, "اتوماسیون‌ها بارگذاری نشدند"));
    const data: AutomationWorkspaceData = result.data;
    setRules(data.rules);
    setRuns(data.runs);
  }

  useEffect(() => {
    if (!identity) return;
    let active = true;
    void load(identity)
      .catch((reason: unknown) => {
        if (active) setMessage(reason instanceof Error ? reason.message : "بارگذاری ناموفق بود");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [identity]);

  const filteredRules = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rules.filter((rule) => {
      if (enabledFilter === "enabled" && !rule.enabled) return false;
      if (enabledFilter === "disabled" && rule.enabled) return false;
      if (!normalized) return true;
      return [rule.name, rule.description, rule.trigger_type, rule.action_type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [enabledFilter, query, rules]);

  const deletableRules = useMemo(
    () => filteredRules.filter((rule) => Number(rule.run_count ?? 0) === 0),
    [filteredRules],
  );
  const selectedVisibleCount = deletableRules.filter((rule) => selectedIds.has(rule.id)).length;
  const allVisibleSelected = deletableRules.length > 0 && selectedVisibleCount === deletableRules.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  function resetForm() {
    setEditingId(undefined);
    setForm({
      name: "",
      description: "",
      triggerType: "application.stage_changed",
      actionType: "notification.create",
      approvalRequired: true,
    });
  }

  function startEdit(rule: AutomationRule) {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      description: rule.description ?? "",
      triggerType: rule.trigger_type,
      actionType: rule.action_type,
      approvalRequired: rule.approval_required,
    });
    setMessage(undefined);
  }

  async function saveRule() {
    if (!identity || !form.name.trim() || !form.triggerType.trim() || !form.actionType.trim()) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const result = editingId
        ? await api.PATCH("/v1/automations/{ruleId}", {
            params: { path: { ruleId: editingId } },
            headers: tenantHeaders(identity, true),
            body: {
              name: form.name.trim(),
              ...(form.description.trim() ? { description: form.description.trim() } : {}),
              triggerType: form.triggerType.trim(),
              actionType: form.actionType.trim(),
              approvalRequired: form.approvalRequired,
            },
          })
        : await api.POST("/v1/automations", {
            headers: tenantHeaders(identity, true),
            body: {
              name: form.name.trim(),
              ...(form.description.trim() ? { description: form.description.trim() } : {}),
              triggerType: form.triggerType.trim(),
              actionType: form.actionType.trim(),
              approvalRequired: form.approvalRequired,
            },
          });

      if (!result.response.ok) {
        setMessage(apiErrorMessage(result, editingId ? "ویرایش اتوماسیون ناموفق بود" : "ایجاد اتوماسیون ناموفق بود"));
        return;
      }
      setMessage(editingId ? "تغییرات اتوماسیون ذخیره شد." : "قانون اتوماسیون در حالت غیرفعال ایجاد شد.");
      resetForm();
      await load(identity);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(rule: AutomationRule) {
    if (!identity) return;
    const result = await api.PATCH("/v1/automations/{ruleId}", {
      params: { path: { ruleId: rule.id } },
      headers: tenantHeaders(identity, true),
      body: { enabled: !rule.enabled },
    });
    if (!result.response.ok) {
      setMessage(apiErrorMessage(result, "به‌روزرسانی ناموفق بود"));
      return;
    }
    await load(identity);
  }

  async function run(rule: AutomationRule) {
    if (!identity) return;
    const result = await api.POST("/v1/automations/{ruleId}/runs", {
      params: { path: { ruleId: rule.id } },
      headers: tenantHeaders(identity, true),
      body: {
        idempotencyKey: `${rule.id}:${Date.now()}:${crypto.randomUUID()}`,
        triggerReference: "manual-ui-test",
        input: { source: "manual_ui" },
      },
    });
    if (!result.response.ok || !result.data) {
      setMessage(apiErrorMessage(result, "اجرای اتوماسیون ناموفق بود"));
      return;
    }
    setMessage(`اجرای اتوماسیون با وضعیت «${faDomainLabel(result.data.state)}» ثبت شد؛ اقدام خارجی فقط از مسیر سرویس‌های پیکربندی‌شده انجام می‌شود.`);
    await load(identity);
  }

  async function approve(runRow: AutomationRun) {
    if (!identity) return;
    const result = await api.POST("/v1/automation-runs/{runId}/approve", {
      params: { path: { runId: runRow.id } },
      headers: tenantHeaders(identity),
    });
    if (!result.response.ok) {
      setMessage(apiErrorMessage(result, "تأیید ناموفق بود"));
      return;
    }
    setMessage("اجرا تأیید و ثبت شد؛ اجرای واقعی همچنان تحت کنترل مرز سرویس و ارائه‌دهنده است.");
    await load(identity);
  }

  function toggleRuleSelection(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const rule of deletableRules) {
        if (checked) next.add(rule.id);
        else next.delete(rule.id);
      }
      return next;
    });
  }

  async function confirmDelete() {
    if (!identity || deleteIds.length === 0 || deleting) return;
    setDeleting(true);
    setMessage(undefined);
    try {
      const result = await api.POST("/v1/automations/bulk-delete", {
        headers: tenantHeaders(identity, true),
        body: { ids: deleteIds },
      });
      if (!result.response.ok || !result.data) {
        setMessage(apiErrorMessage(result, "حذف اتوماسیون‌ها ناموفق بود"));
        return;
      }
      const deletedIds = new Set(result.data.deletedIds);
      setRules((current) => current.filter((rule) => !deletedIds.has(rule.id)));
      setSelectedIds((current) => {
        const next = new Set(current);
        result.data.deletedIds.forEach((id) => next.delete(id));
        return next;
      });
      setMessage(
        result.data.blockedIds.length
          ? `${result.data.deletedCount} قانون حذف شد؛ قوانین دارای سابقه اجرا برای حفظ حسابرسی حذف نشدند.`
          : `${result.data.deletedCount} قانون اتوماسیون حذف شد.`,
      );
      setDeleteIds([]);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[10px] font-medium text-indigo-600">هماهنگ‌سازی کنترل‌شده فرایندها</div>
        <h1 className="mt-2 text-[26px] font-semibold">اتوماسیون‌ها</h1>
        <p className="mt-1 text-[11px] text-slate-500">قوانین را ایجاد، جست‌وجو، ویرایش و مدیریت کنید؛ اجرای دارای سابقه برای حفظ حسابرسی حذف نمی‌شود.</p>
      </div>

      {error || message ? <InlineFeedback tone={error ? "error" : "success"}>{error || message}</InlineFeedback> : null}

      {access.can("automation.manage") ? (
        <Panel className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold text-slate-900">{editingId ? "ویرایش قانون اتوماسیون" : "ایجاد قانون اتوماسیون"}</h2>
              <p className="mt-1 text-[10px] text-slate-500">قانون جدید ابتدا غیرفعال ساخته می‌شود تا قبل از اجرا بازبینی شود.</p>
            </div>
            {editingId ? <button type="button" onClick={resetForm} className="text-[10px] font-semibold text-slate-500 hover:text-slate-800">انصراف از ویرایش</button> : null}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="نام اتوماسیون" className="h-10 rounded-lg border border-slate-200 px-3 text-[11px]" />
            <input value={form.triggerType} onChange={(event) => setForm({ ...form, triggerType: event.target.value })} placeholder="application.stage_changed" className="h-10 rounded-lg border border-slate-200 px-3 text-[11px]" />
            <input value={form.actionType} onChange={(event) => setForm({ ...form, actionType: event.target.value })} placeholder="notification.create" className="h-10 rounded-lg border border-slate-200 px-3 text-[11px]" />
            <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-[10px] text-slate-700">
              <input type="checkbox" checked={form.approvalRequired} onChange={(event) => setForm({ ...form, approvalRequired: event.target.checked })} />
              تأیید انسانی الزامی
            </label>
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="توضیح کاربرد این قانون" className="min-h-20 rounded-lg border border-slate-200 p-3 text-[11px] md:col-span-2 xl:col-span-3" />
            <div className="flex items-end gap-2">
              <button type="button" disabled={saving || !form.name.trim() || !form.triggerType.trim() || !form.actionType.trim()} onClick={() => void saveRule()} className="h-10 rounded-lg bg-indigo-600 px-4 text-[10px] font-semibold text-white disabled:opacity-50">
                {saving ? "در حال ذخیره…" : editingId ? "ذخیره تغییرات" : "ایجاد اتوماسیون"}
              </button>
              {editingId ? <button type="button" onClick={resetForm} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-600">انصراف</button> : null}
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel className="overflow-hidden">
        {selectedIds.size > 0 ? (
          <BulkActionBar selectedCount={selectedIds.size} noun="قانون" onClear={() => setSelectedIds(new Set())}>
            <button type="button" onClick={() => setDeleteIds([...selectedIds])} className="h-8 rounded-lg bg-rose-600 px-3 text-[10px] font-semibold text-white hover:bg-rose-700">
              حذف انتخاب‌شده‌ها
            </button>
          </BulkActionBar>
        ) : (
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
            <div className="relative min-w-[260px] flex-1">
              <Icon name="search" size={14} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجو در نام، محرک یا اقدام..." className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 ps-10 pe-3 text-[11px] outline-none focus:border-indigo-300 focus:bg-white" />
            </div>
            <select value={enabledFilter} onChange={(event) => setEnabledFilter(event.target.value)} aria-label="فیلتر وضعیت اتوماسیون" className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[11px]">
              <option value="all">همه وضعیت‌ها</option>
              <option value="enabled">فعال</option>
              <option value="disabled">غیرفعال</option>
            </select>
          </div>
        )}

        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-700">
            {access.can("automation.manage") ? (
              <SelectionCheckbox label="انتخاب همه قوانین قابل حذف" checked={allVisibleSelected} indeterminate={someVisibleSelected} disabled={deletableRules.length === 0} onChange={toggleAllVisible} />
            ) : null}
            قوانین
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {loading ? <div className="p-5 text-[10px] text-slate-500">در حال بارگذاری قوانین اتوماسیون…</div> : filteredRules.length ? filteredRules.map((rule) => (
            <div key={rule.id} className="flex flex-wrap items-center gap-3 p-4">
              {access.can("automation.manage") ? (
                <SelectionCheckbox
                  label={`انتخاب ${rule.name}`}
                  checked={selectedIds.has(rule.id)}
                  disabled={Number(rule.run_count ?? 0) > 0}
                  onChange={(checked) => toggleRuleSelection(rule.id, checked)}
                />
              ) : null}
              <div className="min-w-[240px] flex-1">
                <div className="text-[10px] font-semibold text-slate-900">{rule.name}</div>
                {rule.description ? <div className="mt-1 text-[9px] text-slate-500">{rule.description}</div> : null}
                <div className="mt-1 text-[9px] text-slate-500">{faDomainLabel(rule.trigger_type)} → {faDomainLabel(rule.action_type)} · تأیید انسانی: {rule.approval_required ? "الزامی" : "غیرالزامی"} · اجراها: {rule.run_count ?? 0}</div>
              </div>
              <Pill tone={rule.enabled ? "green" : "slate"}>{rule.enabled ? "فعال" : "غیرفعال"}</Pill>
              {access.can("automation.manage") ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => startEdit(rule)} className="rounded-lg border border-slate-200 px-3 py-2 text-[9px] font-semibold text-slate-700">ویرایش</button>
                  <button type="button" onClick={() => void toggle(rule)} className="rounded-lg border border-slate-200 px-3 py-2 text-[9px]">{rule.enabled ? "غیرفعال‌کردن" : "فعال‌کردن"}</button>
                  <button type="button" disabled={!rule.enabled} onClick={() => void run(rule)} className="rounded-lg bg-indigo-600 px-3 py-2 text-[9px] font-semibold text-white disabled:opacity-40">ایجاد اجرا</button>
                  {Number(rule.run_count ?? 0) === 0 ? <button type="button" onClick={() => setDeleteIds([rule.id])} className="rounded-lg px-2 py-2 text-[9px] font-semibold text-rose-600">حذف</button> : null}
                </div>
              ) : null}
            </div>
          )) : <div className="p-5 text-[10px] text-slate-500">{rules.length ? "قانونی با فیلترهای فعلی پیدا نشد." : "قانون اتوماسیونی وجود ندارد."}</div>}
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="border-b border-slate-100 p-4 text-[12px] font-semibold">اجراهای اخیر</div>
        <div className="divide-y divide-slate-100">{runs.slice(0, 30).map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0"><div className="break-all text-[9px] font-semibold">{row.idempotency_key}</div><div className="mt-1 text-[8px] text-slate-400">{formatFaDateTime(row.created_at)}</div></div><div className="flex items-center gap-2"><Pill tone={row.state === "failed" ? "red" : row.state === "approval_required" ? "amber" : "blue"}>{faDomainLabel(row.state)}</Pill>{row.state === "approval_required" ? <button onClick={() => void approve(row)} className="rounded-lg bg-emerald-600 px-3 py-2 text-[9px] font-semibold text-white">تأیید</button> : null}</div></div>)}</div>
      </Panel>

      <ConfirmDialog
        open={deleteIds.length > 0}
        title={deleteIds.length > 1 ? "حذف قوانین انتخاب‌شده؟" : "حذف قانون اتوماسیون؟"}
        description={
          deleteIds.length > 1
            ? "فقط قوانینی که هنوز هیچ اجرای ثبت‌شده‌ای ندارند حذف می‌شوند. قوانین دارای سابقه برای حفظ حسابرسی باقی می‌مانند."
            : "اگر این قانون سابقه اجرا نداشته باشد حذف می‌شود. قوانین دارای سابقه اجرا باید غیرفعال شوند و حذف نمی‌شوند."
        }
        confirmLabel={deleteIds.length > 1 ? "حذف قوانین" : "حذف قانون"}
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteIds([])}
      />
    </div>
  );
}

export function IntegrationsWorkspace() {
  const { identity, error } = useIdentity();
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load(current: TenantIdentity) {
    const result = await api.GET("/v1/integrations", { headers: tenantHeaders(current) });
    if (!result.response.ok || !result.data) throw new Error(apiErrorMessage(result, "یکپارچه‌سازی‌ها بارگذاری نشدند"));
    setRows(result.data);
  }

  useEffect(() => {
    if (!identity) return;
    let active = true;
    void load(identity)
      .catch((reason: unknown) => {
        if (active) setMessage(reason instanceof Error ? reason.message : "بارگذاری ناموفق بود");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [identity]);

  async function configure() {
    if (!identity) return;
    const providerKey = window.prompt("کلید ارائه‌دهنده (مثلاً greenhouse، google-calendar یا smtp)")?.trim();
    if (!providerKey) return;
    const connectionType = window.prompt("نوع اتصال", "api")?.trim();
    if (!connectionType) return;
    const credentialReference = window.prompt("فقط مرجع امن راز خارجی (مثلاً vault://interview/provider)")?.trim();
    if (!credentialReference) return;
    const result = await api.POST("/v1/integrations", {
      headers: tenantHeaders(identity, true),
      body: { providerKey, connectionType, credentialReference, config: {} },
    });
    if (!result.response.ok) {
      setMessage(apiErrorMessage(result, "پیکربندی ناموفق بود"));
      return;
    }
    setMessage("پیکربندی یکپارچه‌سازی با مرجع امن ذخیره شد و هیچ اطلاعات احراز هویت خامی ثبت نشد.");
    await load(identity);
  }

  async function configureCandidateSource(
    providerKey: "people_data_labs" | "coresignal",
    suggestedReference: string,
  ) {
    if (!identity) return;
    const credentialReference = window.prompt(
      "مرجع متغیر محیطی API Key را وارد کنید؛ خود API Key را اینجا وارد نکنید.",
      suggestedReference,
    )?.trim();
    if (!credentialReference) return;
    if (!/^env:\/\/[A-Z][A-Z0-9_]{2,100}$/.test(credentialReference)) {
      setMessage("برای کاندیدیاب فعلاً مرجع باید به شکل env://PREFIX باشد؛ مثال: env://PEOPLE_DATA_LABS");
      return;
    }
    const usageApproved = window.confirm(
      "تأیید می‌کنید استفاده از این منبع برای Recruiting و پردازش داده کاندید طبق سیاست حریم خصوصی سازمان مجاز است؟",
    );
    if (!usageApproved) {
      setMessage("اتصال کاندیدیاب ثبت نشد؛ تأیید صریح استفاده Recruiting/Privacy الزامی است.");
      return;
    }
    const existingCandidateSources = rows.filter(
      (row) =>
        row.connection_type === "candidate_source" &&
        row.status !== "disabled" &&
        ["people_data_labs", "coresignal"].includes(row.provider_key),
    );
    const defaultForSourcing = existingCandidateSources.length === 0;
    const result = await api.POST("/v1/integrations", {
      headers: tenantHeaders(identity, true),
      body: {
        providerKey,
        connectionType: "candidate_source",
        credentialReference,
        config: {
          approvedForRecruitingUse: true,
          privacyUseApproved: true,
          defaultForSourcing,
        },
      },
    });
    if (!result.response.ok) {
      setMessage(apiErrorMessage(result, "پیکربندی منبع کاندیدیاب ناموفق بود"));
      return;
    }
    setMessage(
      defaultForSourcing
        ? "منبع کاندیدیاب با تأیید استفاده استخدامی/حریم خصوصی ثبت و به‌عنوان منبع پیش‌فرض فعال شد."
        : "منبع کاندیدیاب ثبت شد. چون منبع دیگری از قبل فعال است، این اتصال به‌صورت پیش‌فرض انتخاب نشد.",
    );
    await load(identity);
  }

  async function setStatus(row: IntegrationRow, status: "configured" | "disabled") {
    if (!identity) return;
    const result = await api.PATCH("/v1/integrations/{integrationId}", {
      params: { path: { integrationId: row.id } },
      headers: tenantHeaders(identity, true),
      body: { status },
    });
    if (!result.response.ok) {
      setMessage(apiErrorMessage(result, "به‌روزرسانی ناموفق بود"));
      return;
    }
    await load(identity);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-medium text-indigo-600">مرز سازمانی مستقل از ارائه‌دهنده</div>
          <h1 className="mt-2 text-[26px] font-semibold">یکپارچه‌سازی‌ها</h1>
          <p className="mt-1 text-[11px] text-slate-500">ATS، تقویم، ایمیل و منابع خارجی مجاز با مرجع امن، وضعیت سلامت و حسابرسی مدیریت می‌شوند.</p>
        </div>
        <button onClick={() => void configure()} className="h-10 rounded-lg bg-indigo-600 px-4 text-[10px] font-semibold text-white">پیکربندی عمومی</button>
      </div>

      {error || message ? <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] text-indigo-800">{error || message}</div> : null}

      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold text-slate-900">منابع کاندیدیاب</div>
            <p className="mt-1 max-w-2xl text-[9px] leading-5 text-slate-500">
              برای جستجوی بیرونی، فقط مرجع متغیر محیطی API Key ثبت می‌شود. خود کلید در دیتابیس یا UI ذخیره نمی‌شود و استفاده Recruiting/Privacy صریحاً تأیید می‌گردد.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void configureCandidateSource("people_data_labs", "env://PEOPLE_DATA_LABS")}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[9px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              اتصال People Data Labs
            </button>
            <button
              type="button"
              onClick={() => void configureCandidateSource("coresignal", "env://CORESIGNAL")}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[9px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              اتصال Coresignal
            </button>
          </div>
        </div>
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[8px] leading-4 text-amber-800">
          قبل از اجرای API، متغیر محیطی متناظر را روی API process تنظیم کنید؛ مثلاً PEOPLE_DATA_LABS_API_KEY یا CORESIGNAL_API_KEY. جستجوی مستقیم/پنهان LinkedIn انجام نمی‌شود.
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="divide-y divide-slate-100">
          {loading ? (
            <div className="p-5 text-[10px] text-slate-500">در حال بارگذاری یکپارچه‌سازی‌ها…</div>
          ) : rows.length ? rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="text-[10px] font-semibold">{row.provider_key} · {faDomainLabel(row.connection_type)}</div>
                <div className="mt-1 text-[9px] text-slate-500">
                  مرجع امن: {row.credential_reference || "پیکربندی نشده"}
                  {row.last_error ? ` · ${row.last_error}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Pill tone={row.status === "verified" ? "green" : row.status === "degraded" ? "amber" : "slate"}>{faDomainLabel(row.status)}</Pill>
                <button onClick={() => void setStatus(row, row.status === "disabled" ? "configured" : "disabled")} className="rounded-lg border border-slate-200 px-3 py-2 text-[9px]">
                  {row.status === "disabled" ? "فعال‌کردن" : "غیرفعال‌کردن"}
                </button>
              </div>
            </div>
          )) : (
            <div className="p-5 text-[10px] text-slate-500">هیچ یکپارچه‌سازی‌ای پیکربندی نشده است.</div>
          )}
        </div>
      </Panel>
      <Panel className="p-4 text-[10px] leading-5 text-slate-600">
        اتصالی که فقط پیکربندی شده باشد تا زمان تأیید توسط مبدل واقعی ارائه‌دهنده، «تأییدشده» محسوب نمی‌شود. توکن و رمز خام طبق سیاست API پذیرفته نمی‌شوند.
      </Panel>
    </div>
  );
}

export function SettingsWorkspace() {
  const { identity, error } = useIdentity();
  const access = useInternalAccess();
  const [settings, setSettings] = useState<SettingsData>();
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load(current: TenantIdentity) {
    const result = await api.GET("/v1/settings", { headers: tenantHeaders(current) });
    if (!result.response.ok || !result.data) throw new Error(apiErrorMessage(result, "تنظیمات بارگذاری نشد"));
    setSettings(result.data);
  }

  useEffect(() => {
    if (!identity) return;
    let active = true;
    void load(identity)
      .catch((reason: unknown) => {
        if (active) setMessage(reason instanceof Error ? reason.message : "بارگذاری ناموفق بود");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [identity]);

  async function save() {
    if (!identity || !settings) return;
    const result = await api.PATCH("/v1/settings", {
      headers: tenantHeaders(identity, true),
      body: {
        defaultLocale: settings.default_locale || "fa",
        timezone: settings.timezone || "UTC",
        hiringPolicy: settings.hiring_policy || {},
        notificationPreferences: settings.notification_preferences || {},
      },
    });
    if (!result.response.ok || !result.data) {
      setMessage(apiErrorMessage(result, "ذخیره تنظیمات ناموفق بود"));
      return;
    }
    setSettings(result.data);
    setMessage("تنظیمات سازمان به‌روزرسانی و حسابرسی شد.");
  }

  return <div className="space-y-5"><div><div className="text-[10px] font-medium text-indigo-600">حاکمیت سازمان</div><h1 className="mt-2 text-[26px] font-semibold">تنظیمات</h1><p className="mt-1 text-[11px] text-slate-500">نقش‌ها و دسترسی‌ها، زبان و منطقه زمانی، حریم خصوصی و سیاست تصمیم انسانی.</p></div>{error || message ? <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] text-indigo-800">{error || message}</div> : null}{loading ? <Panel className="p-5 text-[10px] text-slate-500">در حال بارگذاری تنظیمات…</Panel> : <><div className="grid gap-4 xl:grid-cols-2"><Panel className="p-5"><h2 className="text-[12px] font-semibold">تنظیمات پیش‌فرض سازمان</h2><label className="mt-4 block text-[9px] font-semibold text-slate-500">زبان پیش‌فرض<select value={settings?.default_locale || "fa"} onChange={(event) => setSettings((current) => current ? { ...current, default_locale: event.target.value } : current)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[10px]"><option value="fa">فارسی</option><option value="en">انگلیسی</option></select></label><label className="mt-3 block text-[9px] font-semibold text-slate-500">منطقه زمانی<input value={settings?.timezone || ""} onChange={(event) => setSettings((current) => current ? { ...current, timezone: event.target.value } : current)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-[10px]" /></label>{access.can("settings.manage") ? <button onClick={() => void save()} className="mt-4 h-9 rounded-lg bg-indigo-600 px-4 text-[9px] font-semibold text-white">ذخیره تنظیمات</button> : null}</Panel><Panel className="p-5"><h2 className="text-[12px] font-semibold">بخش‌های حاکمیتی</h2><div className="mt-4 grid gap-2"><Link href="/app/settings/users" className="rounded-lg border border-slate-200 p-3 text-[10px] font-semibold text-slate-700">کاربران و نقش‌ها</Link>{access.can("audit.read") ? <Link href="/app/settings/audit" className="rounded-lg border border-slate-200 p-3 text-[10px] font-semibold text-slate-700">مرور حسابرسی</Link> : null}<Link href="/app/analytics" className="rounded-lg border border-slate-200 p-3 text-[10px] font-semibold text-slate-700">تحلیل‌ها</Link></div></Panel></div><Panel className="p-5"><h2 className="text-[12px] font-semibold">اصول غیرقابل‌تغییر استخدام</h2><div className="mt-3 grid gap-2 md:grid-cols-3">{["شواهد پیش از امتیاز", "تصمیم و تغییر نتیجه توسط انسان", "عدم استنباط تناسب شغلی از چهره، بدن یا لهجه"].map((item) => <div key={item} className="rounded-lg bg-emerald-50 p-3 text-[9px] font-semibold text-emerald-800">{item}</div>)}</div></Panel></>}</div>;
}

export function SearchWorkspace({ initialQuery }: { initialQuery: string }) {
  const { identity, error } = useIdentity();
  const [query, setQuery] = useState(initialQuery);
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function search(value = query) {
    if (!identity || value.trim().length < 2) return;
    setLoading(true);
    const result = await api.GET("/v1/search", {
      params: { query: { q: value.trim() } },
      headers: tenantHeaders(identity),
    });
    setLoading(false);
    if (!result.response.ok || !result.data) {
      setMessage(apiErrorMessage(result, "جست‌وجو ناموفق بود"));
      return;
    }
    setRows(result.data);
    setMessage(undefined);
  }

  useEffect(() => {
    if (identity && initialQuery.trim().length >= 2) void search(initialQuery);
  }, [identity, initialQuery]);

  return <div className="space-y-5"><div><h1 className="text-[26px] font-semibold">جست‌وجوی سراسری</h1><p className="mt-1 text-[11px] text-slate-500">جست‌وجو در محدوده سازمان و بر اساس سطح دسترسی در موقعیت‌ها، کاندیداها و مصاحبه‌ها.</p></div><form onSubmit={(event) => { event.preventDefault(); void search(); }} className="flex flex-col gap-2 sm:flex-row"><input value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 flex-1 rounded-lg border border-slate-200 px-4 text-[11px]" placeholder="جست‌وجوی موقعیت، کاندیدا یا مصاحبه…" /><button className="rounded-lg bg-indigo-600 px-5 text-[10px] font-semibold text-white">جست‌وجو</button></form>{error || message ? <div className="rounded-xl bg-rose-50 p-3 text-[10px] text-rose-700">{error || message}</div> : null}<Panel className="overflow-hidden"><div className="divide-y divide-slate-100">{loading ? <div className="p-5 text-[10px] text-slate-500">در حال جست‌وجو…</div> : rows.map((row) => <Link key={`${row.type}:${row.id}`} href={row.href} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50"><div><div className="text-[10px] font-semibold text-slate-800">{row.title}</div><div className="mt-1 text-[9px] text-slate-500">{row.subtitle || row.type}</div></div><Pill>{faDomainLabel(row.type)}</Pill></Link>)}{!loading && query.trim().length >= 2 && !rows.length ? <div className="p-5 text-[10px] text-slate-500">نتیجه‌ای برای نمایش پیدا نشد.</div> : null}</div></Panel></div>;
}

export function AuditWorkspace() {
  const { identity, error } = useIdentity();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [action, setAction] = useState("");
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load(current = identity, filter = action) {
    if (!current) return;
    const query = filter.trim() ? { limit: 200, action: filter.trim() } : { limit: 200 };
    const result = await api.GET("/v1/audit/events", {
      params: { query },
      headers: tenantHeaders(current),
    });
    if (!result.response.ok || !result.data) {
      setMessage(apiErrorMessage(result, "رویدادهای حسابرسی بارگذاری نشدند"));
      return;
    }
    setRows(result.data);
    setMessage(undefined);
  }

  useEffect(() => {
    if (!identity) return;
    let active = true;
    void load(identity, "").finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [identity]);

  return <div className="space-y-5"><div><h1 className="text-[26px] font-semibold">مرور حسابرسی</h1><p className="mt-1 text-[11px] text-slate-500">تاریخچه عامل، اقدام و موجودیت برای عملیات حساس در محدوده سازمان.</p></div><form onSubmit={(event) => { event.preventDefault(); void load(identity, action); }} className="flex flex-col gap-2 sm:flex-row"><input value={action} onChange={(event) => setAction(event.target.value)} className="h-10 flex-1 rounded-lg border border-slate-200 px-3 text-[10px]" placeholder="فیلتر دقیق اقدام؛ مثلاً auth.login" /><button className="rounded-lg border border-slate-200 px-4 text-[9px] font-semibold">فیلتر</button></form>{error || message ? <div className="rounded-xl bg-rose-50 p-3 text-[10px] text-rose-700">{error || message}</div> : null}<Panel className="overflow-x-auto">{loading ? <div className="p-5 text-[10px] text-slate-500">در حال بارگذاری رویدادهای حسابرسی…</div> : <table className="w-full min-w-[900px] text-start text-[9px]"><thead className="bg-slate-50 text-slate-400"><tr><th className="p-3">زمان</th><th className="p-3">اقدام</th><th className="p-3">عامل</th><th className="p-3">موجودیت</th><th className="p-3">فراداده</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id}><td className="p-3">{formatFaDateTime(row.created_at)}</td><td className="p-3 font-semibold">{row.action}</td><td className="p-3">{faDomainLabel(row.actor_type)}:{row.actor_user_id || "سیستم"}</td><td className="p-3">{faDomainLabel(row.entity_type)}:{row.entity_id || "—"}</td><td className="max-w-[360px] truncate p-3 text-slate-500">{JSON.stringify(row.metadata || {})}</td></tr>)}</tbody></table>}</Panel></div>;
}
