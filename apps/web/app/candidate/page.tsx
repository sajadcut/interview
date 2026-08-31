import { Icon } from "../../components/product/icon";

const steps = [
  ["Invitation", "Verified invite", "complete"],
  ["Consent", "Recording and transcript disclosure", "current"],
  ["Device check", "Camera, microphone and network", "next"],
  ["Introduction", "What to expect and how to ask for help", "next"],
  ["AI interview", "Structured job-relevant conversation", "next"],
  ["Technical task", "Only when this role requires it", "next"],
  ["Completion", "Next steps and candidate feedback", "next"],
] as const;

export default function CandidatePage() {
  return (
    <main
      lang="en"
      dir="ltr"
      className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8 lg:py-8"
    >
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-slate-200 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(15,23,42,.03)]">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-[12px] bg-indigo-600 text-white"><Icon name="sparkles" size={17} /></div>
            <div><div className="text-[14px] font-semibold">AI Recruiter</div><div className="text-[11px] text-slate-500">Candidate interview experience</div></div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 font-medium text-slate-500">Secure invitation session</span>
            <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 font-medium text-emerald-700">Invite verified</span>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="self-start rounded-[16px] border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-6">
            <div className="text-[11px] font-semibold uppercase tracking-[.12em] text-slate-400">Your interview</div>
            <h1 className="mt-2 text-[24px] font-semibold tracking-tight">Senior Backend Engineer</h1>
            <p className="mt-2 text-[12px] leading-5 text-slate-500">Structured technical interview · Persian with technical English · approximately 45 minutes.</p>
            <div className="mt-5 grid grid-cols-2 gap-2 rounded-[11px] border border-slate-100 bg-slate-50 p-3 text-[10px]">
              <div><div className="text-slate-400">Format</div><div className="mt-1 font-semibold text-slate-700">AI technical</div></div>
              <div><div className="text-slate-400">Stage</div><div className="mt-1 font-semibold text-slate-700">Consent</div></div>
            </div>
            <div className="mt-5 space-y-1">
              {steps.map(([label, note, state], index) => (
                <div key={label} className={`flex gap-3 rounded-[11px] p-3 ${state === "current" ? "bg-indigo-50 ring-1 ring-indigo-100" : ""}`}>
                  <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${state === "complete" ? "bg-emerald-100 text-emerald-700" : state === "current" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"}`}>{state === "complete" ? "✓" : index + 1}</div>
                  <div><div className={`text-[11px] font-semibold ${state === "current" ? "text-indigo-800" : "text-slate-800"}`}>{label}</div><div className="mt-0.5 text-[9px] leading-4 text-slate-400">{note}</div></div>
                </div>
              ))}
            </div>
          </aside>

          <section className="rounded-[16px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8 lg:p-9">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-indigo-50 text-indigo-600"><Icon name="shield" size={17} /></div>
              <div><div className="text-[11px] font-medium text-indigo-600">Consent & privacy</div><h2 className="mt-1 text-[26px] font-semibold tracking-tight">Before your interview starts</h2><p className="mt-2 max-w-2xl text-[12px] leading-6 text-slate-500">Understand what may be recorded, how transcript and evidence are used, what the AI interviewer can and cannot evaluate, and how to stop or ask for help.</p></div>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[12px] border border-slate-100 bg-slate-50 p-4"><div className="flex items-center gap-2 text-[11px] font-semibold"><Icon name="message" size={14} className="text-indigo-600" /> Transcript</div><p className="mt-2 text-[10px] leading-5 text-slate-500">Your answers may be transcribed so reviewers can inspect timestamped job-relevant evidence.</p></div>
              <div className="rounded-[12px] border border-slate-100 bg-slate-50 p-4"><div className="flex items-center gap-2 text-[11px] font-semibold"><Icon name="interviews" size={14} className="text-indigo-600" /> Recording</div><p className="mt-2 text-[10px] leading-5 text-slate-500">Audio/video recording is used only when the interview policy permits it and your consent state allows it.</p></div>
              <div className="rounded-[12px] border border-slate-100 bg-slate-50 p-4"><div className="flex items-center gap-2 text-[11px] font-semibold"><Icon name="target" size={14} className="text-indigo-600" /> Evaluation</div><p className="mt-2 text-[10px] leading-5 text-slate-500">Evaluation is based on job-relevant evidence and a versioned rubric. Final hiring decisions remain human-controlled.</p></div>
              <div className="rounded-[12px] border border-slate-100 bg-slate-50 p-4"><div className="flex items-center gap-2 text-[11px] font-semibold"><Icon name="candidates" size={14} className="text-indigo-600" /> No biometric personality scoring</div><p className="mt-2 text-[10px] leading-5 text-slate-500">Face, body movement, gaze or accent are not used to infer honesty, personality, emotion, confidence or suitability.</p></div>
            </div>

            <div className="mt-6 rounded-[12px] border border-amber-100 bg-amber-50 p-4 text-[10px] leading-5 text-amber-800">Development candidate surface. Real invitation identity, consent persistence, device APIs and interview media remain release-gated and are not represented as production-ready.</div>

            <label className="mt-6 flex items-start gap-3 rounded-[12px] border border-slate-200 p-4 transition hover:bg-slate-50">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" />
              <span><span className="block text-[11px] font-semibold">I understand the interview, transcript and recording information above.</span><span className="mt-1 block text-[10px] leading-5 text-slate-500">Consent must be versioned and revocable according to organization policy and applicable rules.</span></span>
            </label>

            <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
              <button className="text-[11px] font-semibold text-slate-500 hover:text-slate-800">Privacy details</button>
              <button className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-indigo-600 px-4 text-[11px] font-semibold text-white shadow-sm hover:bg-indigo-700">Continue to device check <Icon name="arrow" size={14} /></button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
