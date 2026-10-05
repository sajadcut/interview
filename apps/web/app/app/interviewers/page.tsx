"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BulkActionBar,
  ConfirmDialog,
  InlineFeedback,
  SelectionCheckbox,
} from "../../../components/product/collection-management";
import { Icon } from "../../../components/product/icon";
import { useInternalAccess } from "../../../components/product/internal-access";
import { Panel, Pill, ToolbarButton } from "../../../components/product/recruiting-ui";
import { formatFaNumber } from "../../../lib/fa-numbers";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../../lib/tenant-client";

type InterviewerProfile = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  jobTitle?: string;
  specialties: string[];
  bio?: string;
  status: "active" | "disabled";
  effectiveStatus: "active" | "pending" | "disabled";
  userId?: string;
  assignmentCount: number;
  invitationPending: boolean;
  updatedAt: string;
};

const EMPTY_FORM = {
  email: "",
  firstName: "",
  lastName: "",
  phone: "",
  jobTitle: "",
  specialties: "",
  bio: "",
  status: "active" as "active" | "disabled",
};

function statusTone(status: InterviewerProfile["effectiveStatus"]): "green" | "amber" | "slate" {
  if (status === "active") return "green";
  if (status === "pending") return "amber";
  return "slate";
}

function statusLabel(status: InterviewerProfile["effectiveStatus"]): string {
  if (status === "active") return "فعال";
  if (status === "pending") return "در انتظار پذیرش دعوت";
  return "غیرفعال";
}

async function backend<T>(
  identity: TenantIdentity,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(tenantHeaders(identity, Boolean(init.body)));
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as { message?: string | string[] } | undefined;
    const message = Array.isArray(payload?.message)
      ? payload?.message.join("؛ ")
      : payload?.message;
    throw new Error(message || "عملیات ناموفق بود");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export default function InterviewersPage() {
  const access = useInternalAccess();
  const [identity, setIdentity] = useState<TenantIdentity>();
  const [profiles, setProfiles] = useState<InterviewerProfile[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<{ tone: "success" | "warning" | "error"; text: string }>();

  const load = useCallback(async (known?: TenantIdentity) => {
    const current = known ?? identity ?? (await resolveTenantIdentity());
    if (!identity) setIdentity(current);
    const data = await backend<InterviewerProfile[]>(
      current,
      "/v1/interview-operations/interviewers",
    );
    setProfiles(data);
  }, [identity]);

  useEffect(() => {
    let active = true;
    void resolveTenantIdentity()
      .then(async (resolved) => {
        if (!active) return;
        setIdentity(resolved);
        await load(resolved);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "فهرست مصاحبه‌گرها بارگذاری نشد");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredProfiles = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return profiles;
    return profiles.filter((item) =>
      [
        item.firstName,
        item.lastName,
        item.email,
        item.phone,
        item.jobTitle,
        item.bio,
        ...item.specialties,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [profiles, query]);

  const selectedVisibleCount = filteredProfiles.filter((item) => selectedIds.has(item.id)).length;
  const allVisibleSelected = filteredProfiles.length > 0 && selectedVisibleCount === filteredProfiles.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  function resetForm() {
    setEditingId(undefined);
    setForm(EMPTY_FORM);
    setFormOpen(false);
  }

  function openCreate() {
    setEditingId(undefined);
    setForm(EMPTY_FORM);
    setFormOpen(true);
    setError(undefined);
    setFeedback(undefined);
  }

  function openEdit(profile: InterviewerProfile) {
    setEditingId(profile.id);
    setForm({
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: profile.phone ?? "",
      jobTitle: profile.jobTitle ?? "",
      specialties: profile.specialties.join("، "),
      bio: profile.bio ?? "",
      status: profile.status,
    });
    setFormOpen(true);
    setError(undefined);
    setFeedback(undefined);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleOne(id: string, checked: boolean) {
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
      for (const item of filteredProfiles) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!identity || busy) return;
    setBusy(true);
    setError(undefined);
    setFeedback(undefined);
    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim() || null,
      jobTitle: form.jobTitle.trim() || null,
      specialties: form.specialties
        .split(/[،,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
      bio: form.bio.trim() || null,
      ...(editingId ? { status: form.status } : { email: form.email.trim() }),
    };
    try {
      if (editingId) {
        await backend(identity, `/v1/interview-operations/interviewers/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setFeedback({ tone: "success", text: "اطلاعات مصاحبه‌گر با موفقیت ویرایش شد." });
      } else {
        await backend(identity, "/v1/interview-operations/interviewers", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setFeedback({
          tone: "success",
          text: "مصاحبه‌گر ایجاد شد. اگر هنوز عضو سازمان نباشد، دعوت‌نامه با نقش مصاحبه‌گر برای او ایجاد می‌شود.",
        });
      }
      resetForm();
      await load(identity);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ذخیره مصاحبه‌گر ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!identity || deleteIds.length === 0 || deleting) return;
    setDeleting(true);
    setError(undefined);
    setFeedback(undefined);
    try {
      const ids = [...deleteIds];
      const results = await Promise.allSettled(
        ids.map((id) =>
          backend<void>(identity, `/v1/interview-operations/interviewers/${id}`, {
            method: "DELETE",
          }),
        ),
      );
      const deletedIds = ids.filter((_, index) => results[index]?.status === "fulfilled");
      const failed = results.flatMap((result) =>
        result.status === "rejected"
          ? [result.reason instanceof Error ? result.reason.message : "حذف ناموفق بود"]
          : [],
      );
      setSelectedIds((current) => {
        const next = new Set(current);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });
      setDeleteIds([]);
      await load(identity);
      setFeedback({
        tone: failed.length ? "warning" : "success",
        text: failed.length
          ? `${formatFaNumber(deletedIds.length)} مصاحبه‌گر حذف شد؛ ${formatFaNumber(failed.length)} مورد حذف نشد: ${failed[0]}`
          : `${formatFaNumber(deletedIds.length)} مصاحبه‌گر با موفقیت حذف شد.`,
      });
    } catch (cause) {
      setFeedback({
        tone: "error",
        text: cause instanceof Error ? cause.message : "حذف مصاحبه‌گر ناموفق بود",
      });
    } finally {
      setDeleting(false);
    }
  }

  const aiMatches =
    !query.trim() ||
    "مصاحبه گر هوش مصنوعی ai interviewer سیستم".includes(query.trim().toLowerCase());

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-[11px] font-medium text-indigo-600">مدیریت مصاحبه</div>
          <h1 className="text-[28px] font-semibold tracking-[-.03em] text-slate-950">مصاحبه‌گرها</h1>
          <p className="mt-1.5 text-[12px] text-slate-500">
            مصاحبه‌گر هوش مصنوعی سیستمی است؛ مصاحبه‌گرهای انسانی پروفایل، تخصص و حساب سازمانی مستقل دارند.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/app/interviews">
            <ToolbarButton icon="interviews">مشاهده مصاحبه‌ها</ToolbarButton>
          </Link>
          {access.can("organization.manage_users") ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-indigo-600 px-3.5 text-[11px] font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              <Icon name="plus" size={15} />
              ایجاد مصاحبه‌گر
            </button>
          ) : null}
        </div>
      </div>

      {error ? <InlineFeedback tone="error">{error}</InlineFeedback> : null}
      {feedback ? <InlineFeedback tone={feedback.tone}>{feedback.text}</InlineFeedback> : null}

      {formOpen && access.can("organization.manage_users") ? (
        <Panel className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                {editingId ? "ویرایش مصاحبه‌گر" : "ایجاد مصاحبه‌گر انسانی"}
              </h2>
              <p className="mt-1 text-[10px] text-slate-500">
                اطلاعات حرفه‌ای برای انتخاب درست مصاحبه‌گر در زمان‌بندی مصاحبه استفاده می‌شود.
              </p>
            </div>
            <button type="button" onClick={resetForm} className="text-[10px] font-semibold text-slate-500">
              بستن
            </button>
          </div>

          <form onSubmit={save} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="text-[10px] font-semibold text-slate-600">
              نام
              <input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-[11px] outline-none focus:border-indigo-300" />
            </label>
            <label className="text-[10px] font-semibold text-slate-600">
              نام خانوادگی
              <input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-[11px] outline-none focus:border-indigo-300" />
            </label>
            <label className="text-[10px] font-semibold text-slate-600">
              ایمیل
              <input type="email" required disabled={Boolean(editingId)} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-[11px] outline-none focus:border-indigo-300 disabled:bg-slate-50 disabled:text-slate-400" />
            </label>
            <label className="text-[10px] font-semibold text-slate-600">
              شماره تلفن
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="مثلاً 0912..." className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-[11px] outline-none focus:border-indigo-300" />
            </label>
            <label className="text-[10px] font-semibold text-slate-600">
              عنوان شغلی
              <input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} placeholder="مثلاً Tech Lead" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-[11px] outline-none focus:border-indigo-300" />
            </label>
            {editingId ? (
              <label className="text-[10px] font-semibold text-slate-600">
                وضعیت
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "active" | "disabled" })} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[11px]">
                  <option value="active">فعال</option>
                  <option value="disabled">غیرفعال</option>
                </select>
              </label>
            ) : null}
            <label className="text-[10px] font-semibold text-slate-600 md:col-span-2 xl:col-span-3">
              تخصص‌ها
              <input value={form.specialties} onChange={(e) => setForm({ ...form, specialties: e.target.value })} placeholder="مثلاً .NET، معماری نرم‌افزار، Kubernetes، System Design" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-[11px] outline-none focus:border-indigo-300" />
              <span className="mt-1 block text-[9px] font-normal text-slate-400">تخصص‌ها را با ویرگول جدا کنید.</span>
            </label>
            <label className="text-[10px] font-semibold text-slate-600 md:col-span-2 xl:col-span-3">
              توضیحات / بیو
              <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} rows={3} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-[11px] outline-none focus:border-indigo-300" />
            </label>
            <div className="flex gap-2 md:col-span-2 xl:col-span-3">
              <button disabled={busy} type="submit" className="h-10 rounded-lg bg-indigo-600 px-5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {busy ? "در حال ذخیره…" : editingId ? "ذخیره تغییرات" : "ایجاد مصاحبه‌گر"}
              </button>
              <button type="button" onClick={resetForm} className="h-10 rounded-lg border border-slate-200 px-4 text-[11px] font-semibold text-slate-600">
                انصراف
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel>
        {selectedIds.size > 0 ? (
          <BulkActionBar selectedCount={selectedIds.size} noun="مصاحبه‌گر" onClear={() => setSelectedIds(new Set())}>
            <button type="button" onClick={() => setDeleteIds([...selectedIds])} className="h-8 rounded-lg bg-rose-600 px-3 text-[10px] font-semibold text-white hover:bg-rose-700">
              حذف انتخاب‌شده‌ها
            </button>
          </BulkActionBar>
        ) : (
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
            <div className="relative min-w-[280px] flex-1">
              <Icon name="search" size={14} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجو بر اساس نام، ایمیل، تلفن، عنوان یا تخصص..." className="h-10 w-full rounded-[10px] border border-slate-200 bg-slate-50 ps-10 pe-3 text-[11px] outline-none focus:border-indigo-300 focus:bg-white" />
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="data-table min-w-[1080px]">
            <thead>
              <tr>
                <th className="w-10">
                  {access.can("organization.manage_users") ? (
                    <SelectionCheckbox label="انتخاب همه مصاحبه‌گرهای انسانی این فهرست" checked={allVisibleSelected} indeterminate={someVisibleSelected} disabled={filteredProfiles.length === 0} onChange={toggleAllVisible} />
                  ) : null}
                </th>
                <th>مصاحبه‌گر</th>
                <th>تماس</th>
                <th>عنوان</th>
                <th>تخصص‌ها</th>
                <th>وضعیت</th>
                <th>مصاحبه‌ها</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {aiMatches ? (
                <tr>
                  <td />
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 place-items-center rounded-full bg-indigo-100 text-indigo-700"><Icon name="sparkles" size={16} /></div>
                      <div><div className="font-semibold text-slate-900">مصاحبه‌گر هوش مصنوعی</div><div className="mt-1 text-[9px] text-slate-400">AI Interviewer · سیستمی</div></div>
                    </div>
                  </td>
                  <td className="text-slate-500">system:ai-interviewer</td>
                  <td>مصاحبه ساختاریافته خودکار</td>
                  <td><div className="flex flex-wrap gap-1"><Pill tone="blue">مصاحبه فنی</Pill><Pill tone="violet">ارزیابی ساختاریافته</Pill></div></td>
                  <td><Pill tone="green">فعال</Pill></td>
                  <td>—</td>
                  <td className="text-[10px] text-slate-400">سیستمی · قابل ویرایش یا حذف نیست</td>
                </tr>
              ) : null}

              {filteredProfiles.map((profile) => (
                <tr key={profile.id}>
                  <td>
                    {access.can("organization.manage_users") ? (
                      <SelectionCheckbox label={`انتخاب ${profile.firstName} ${profile.lastName}`} checked={selectedIds.has(profile.id)} onChange={(checked) => toggleOne(profile.id, checked)} />
                    ) : null}
                  </td>
                  <td>
                    <div className="font-semibold text-slate-900">{profile.firstName} {profile.lastName}</div>
                    <div className="mt-1 text-[9px] text-slate-400">{profile.email}</div>
                  </td>
                  <td><div>{profile.phone || "—"}</div><div className="mt-1 text-[9px] text-slate-400">{profile.email}</div></td>
                  <td>{profile.jobTitle || "—"}</td>
                  <td>
                    <div className="flex max-w-[320px] flex-wrap gap-1">
                      {profile.specialties.length ? profile.specialties.slice(0, 5).map((skill) => <Pill key={skill}>{skill}</Pill>) : <span className="text-slate-400">ثبت نشده</span>}
                    </div>
                  </td>
                  <td>
                    <Pill tone={statusTone(profile.effectiveStatus)}>{statusLabel(profile.effectiveStatus)}</Pill>
                    {profile.invitationPending ? <div className="mt-1 text-[9px] text-amber-600">دعوت‌نامه فعال</div> : null}
                  </td>
                  <td className="font-semibold text-slate-700">{formatFaNumber(profile.assignmentCount)}</td>
                  <td className="whitespace-nowrap">
                    {access.can("organization.manage_users") ? (
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={() => openEdit(profile)} className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800">ویرایش</button>
                        <button type="button" onClick={() => setDeleteIds([profile.id])} title={profile.assignmentCount > 0 ? "در صورت داشتن مصاحبه فعال، سرور دلیل عدم حذف را اعلام می‌کند." : "حذف مصاحبه‌گر"} className="text-[10px] font-semibold text-rose-600 hover:text-rose-700">حذف</button>
                      </div>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}

              {loading ? <tr><td colSpan={8} className="py-10 text-center text-slate-400">در حال بارگذاری مصاحبه‌گرها…</td></tr> : null}
              {!loading && filteredProfiles.length === 0 && !aiMatches ? <tr><td colSpan={8} className="py-10 text-center text-slate-400">مصاحبه‌گری با این جست‌وجو پیدا نشد.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <ConfirmDialog
        open={deleteIds.length > 0}
        title={deleteIds.length > 1 ? "حذف مصاحبه‌گرهای انتخاب‌شده؟" : "حذف مصاحبه‌گر؟"}
        description="پروفایل مصاحبه‌گر حذف می‌شود و دیگر برای مصاحبه جدید قابل انتخاب نخواهد بود. سوابق مصاحبه‌های قبلی حفظ می‌شوند. اگر مصاحبه فعال به او تخصیص داده شده باشد، حذف آن مورد انجام نمی‌شود و دلیل نمایش داده می‌شود."
        confirmLabel={deleteIds.length > 1 ? "حذف مصاحبه‌گرها" : "حذف مصاحبه‌گر"}
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteIds([])}
      />
    </div>
  );
}
