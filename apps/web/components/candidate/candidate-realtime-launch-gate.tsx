export function CandidateRealtimeLaunchGate() {
  return (
    <div className="bg-slate-50 px-4 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl rounded-[12px] border border-amber-100 bg-amber-50 px-4 py-3 text-[10px] leading-5 text-amber-900 shadow-sm">
        <div className="font-semibold">Realtime interview launch gate</div>
        <div className="mt-1">
          Device readiness alone does not unlock the AI interview. Candidate authentication, server-side consent,
          release policy and the self-hosted transport/VAD/STT/TTS pipeline must all pass runtime preflight. The
          realtime candidate connection remains disabled until those checks are validated; no simulated media
          connection is shown as live.
        </div>
      </div>
    </div>
  );
}
