"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { formatFaNumber } from "../../lib/fa-numbers";

export function SelectionCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      className="h-4 w-4 rounded border-slate-300 text-indigo-600 accent-indigo-600 focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}

export function BulkActionBar({
  selectedCount,
  noun,
  onClear,
  children,
}: {
  selectedCount: number;
  noun: string;
  onClear: () => void;
  children: ReactNode;
}) {
  if (selectedCount <= 0) return null;
  return (
    <div
      className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-indigo-100 bg-indigo-50 px-4 py-2.5"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-semibold text-indigo-900">
          {formatFaNumber(selectedCount)} {noun} انتخاب شده
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800"
        >
          لغو انتخاب
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "انصراف",
  busy = false,
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/35 p-4 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="destructive-dialog-title"
        aria-describedby="destructive-dialog-description"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
      >
        <h2 id="destructive-dialog-title" className="text-[15px] font-semibold text-slate-950">
          {title}
        </h2>
        <div id="destructive-dialog-description" className="mt-2 text-[11px] leading-6 text-slate-600">
          {description}
        </div>
        <div className="mt-5 flex flex-row-reverse gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={
              danger
                ? "h-10 rounded-[10px] bg-rose-600 px-4 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                : "h-10 rounded-[10px] bg-indigo-600 px-4 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            }
          >
            {busy ? "در حال انجام…" : confirmLabel}
          </button>
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-10 rounded-[10px] border border-slate-200 bg-white px-4 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function InlineFeedback({
  tone = "success",
  children,
}: {
  tone?: "success" | "warning" | "error";
  children: ReactNode;
}) {
  const styles = {
    success: "border-emerald-100 bg-emerald-50 text-emerald-800",
    warning: "border-amber-100 bg-amber-50 text-amber-800",
    error: "border-rose-100 bg-rose-50 text-rose-800",
  } as const;
  return (
    <div className={`rounded-xl border px-4 py-3 text-[10px] leading-5 ${styles[tone]}`} role="status">
      {children}
    </div>
  );
}
