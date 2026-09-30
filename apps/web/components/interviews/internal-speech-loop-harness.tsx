"use client";

import { useEffect, useState } from "react";

type DevelopmentContext = {
  ready: boolean;
  reason?: string;
  organizationId?: string;
  userId?: string;
  fixtures?: {
    applicationId: string;
    interviewPlanId: string;
    consentRecordId: string;
  };
};

const apiUrl = "/api/backend";

function authHeaders(context: DevelopmentContext): HeadersInit {
  if (!context.organizationId || !context.userId) throw new Error("اطلاعات دسترسی API محیط توسعه کامل نیست.");
  return {
    "content-type": "application/json",
    "x-organization-id": context.organizationId,
    "x-user-id": context.userId,
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = Array.isArray(data.message)
      ? data.message.filter((item): item is string => typeof item === "string").join("; ")
      : typeof data.message === "string"
        ? data.message
        : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return data as T;
}

export function InternalSpeechLoopHarness() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("مسیر مغز مصاحبه ← متن گفتاری ذخیره‌شده ← TTS محلی هنوز آزمایش نشده است.");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [turnPreview, setTurnPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  async function run() {
    setBusy(true);
    setMessage("در حال آماده‌سازی آزمایش مسیر مغز مصاحبه به TTS…");
    setTurnPreview(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    try {
      const context = await readJson<DevelopmentContext>(
        await fetch(`${apiUrl}/development/context`, { cache: "no-store" }),
      );
      if (!context.ready || !context.fixtures) throw new Error(context.reason ?? "داده‌های آزمایشی محیط توسعه آماده نیستند.");

      const session = await readJson<{ id: string }>(
        await fetch(`${apiUrl}/v1/interviews/sessions`, {
          method: "POST",
          headers: authHeaders(context),
          body: JSON.stringify({
            applicationId: context.fixtures.applicationId,
            interviewPlanId: context.fixtures.interviewPlanId,
            consentRecordId: context.fixtures.consentRecordId,
            candidateIsRealCustomerCandidate: false,
            synchronousHumanSupervisorPresent: false,
          }),
        }),
      );

      await readJson(
        await fetch(`${apiUrl}/v1/interviews/${session.id}/state/transitions`, {
          method: "POST",
          headers: authHeaders(context),
          body: JSON.stringify({
            idempotencyKey: `speech-loop-start-${session.id}`,
            action: "start",
          }),
        }),
      );

      const turn = await readJson<{ id: string; spokenText: string }>(
        await fetch(`${apiUrl}/v1/interviews/${session.id}/brain/next-turn`, {
          method: "POST",
          headers: authHeaders(context),
          body: JSON.stringify({ elapsedSeconds: 0 }),
        }),
      );
      setTurnPreview(turn.spokenText);

      const mediaSession = await readJson<{ id: string }>(
        await fetch(`${apiUrl}/v1/interviews/${session.id}/media/sessions`, {
          method: "POST",
          headers: authHeaders(context),
          body: JSON.stringify({ mode: "audio" }),
        }),
      );

      const audioResponse = await fetch(
        `${apiUrl}/v1/interviews/${session.id}/media/sessions/${mediaSession.id}/turns/${turn.id}/audio`,
        {
          method: "POST",
          headers: authHeaders(context),
        },
      );
      if (!audioResponse.ok) {
        const detail = await audioResponse.text();
        throw new Error(`پل ارتباطی TTS ناموفق بود (${audioResponse.status}): ${detail.slice(0, 500)}`);
      }
      const blob = await audioResponse.blob();
      if (!blob.type.startsWith("audio/")) throw new Error(`نوع پاسخ TTS غیرمنتظره است: ${blob.type || "نامشخص"}`);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setMessage("متن گفتاری نهایی و ذخیره‌شده با پردازشگر محلی به گفتار تبدیل شد. سرویس TTS متن دلخواه ارسالی از مرورگر را نپذیرفته است.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "آزمایش مسیر مغز مصاحبه به TTS ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[14px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-indigo-600">مرحله ۴ · آزمایش چرخه گفتار</div>
      <div className="mt-1 text-[13px] font-semibold text-slate-900">نوبت ذخیره‌شده مغز مصاحبه ← TTS محلی</div>
      <p className="mt-1 max-w-3xl text-[10px] leading-5 text-slate-500">این مسیر فیلد `spoken_text` را از نوبت نهایی ذخیره‌شده در سرور می‌خواند. مرورگر هیچ متن دلخواهی برای مصاحبه به TTS ارسال نمی‌کند.</p>
      <div className="mt-4 rounded-[10px] bg-slate-50 p-3 text-[10px] leading-5 text-slate-600">{message}</div>
      {turnPreview ? <div className="mt-3 rounded-[10px] border border-slate-100 p-3 text-[10px] leading-5 text-slate-600"><span className="font-semibold text-slate-800">متن گفتاری ذخیره‌شده:</span> {turnPreview}</div> : null}
      {audioUrl ? <audio className="mt-3 w-full" controls src={audioUrl} /> : null}
      <button type="button" disabled={busy} onClick={run} className="mt-4 h-9 rounded-[9px] bg-indigo-600 px-4 text-[10px] font-semibold text-white disabled:bg-slate-300">{busy ? "در حال اجرا…" : "آزمایش مسیر مغز مصاحبه به TTS"}</button>
    </section>
  );
}
