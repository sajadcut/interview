# Candidate Interview UI Contract v1

`/candidate/interview` is the candidate-facing shell for the realtime interview. It is deliberately separate from recruiter/internal media controls and is safe to complete before the production realtime runtime is connected.

## Security boundary

The page is entered only after the cookie-backed candidate session and persisted candidate consent checks pass. Candidate code must not call recruiter/tenant media endpoints, send `x-organization-id` or `x-user-id`, or reuse internal LiveKit harness credentials. The current page receives no room token and cannot manufacture a live connection.

The UI accepts an optional `CandidateInterviewRuntime` adapter. Until a real candidate-scoped runtime is provided, selecting **Check realtime availability** transitions to a degraded but recoverable state and offers **Resume later with this secure session**. It never renders a fake live state.

## State model

The reducer owns these explicit states: `permissions`, `ready`, `connecting`, `live`, `reconnecting`, `offline`, `degraded`, `fatal`, and `completed`.

Only a runtime `CONNECTED` event can move the UI to `live`. Browser offline state preserves the secure session. If a previously connected interview returns online, it passes through `reconnecting`; before first connection it returns to the last safe phase. Reconnect attempts are bounded at three, after which the UI degrades to the resume-later fallback rather than looping forever.

Session expiry and missing consent are fatal. Permission, device, network, runtime and transport failures are recoverable and have explicit UI actions.

## Media permissions and privacy

Camera and microphone capture is requested only after an explicit candidate action. Microphone permission is mandatory. If camera access is denied or unavailable, the candidate can explicitly select audio-only mode; audio-only still requires a live microphone track.

The preview is local to the page. This UI does not persist raw audio/video, perform biometric analysis, infer emotion, truthfulness, personality, or job fit from media, or expose internal media identifiers. Candidates can mute their microphone or disable camera tracks locally.

## Fallback policy

Fallbacks are limited to reviewing browser permissions, audio-only mode, bounded connection retry, and resuming later with the same secure session. There is no synthetic AI answer, fake interviewer, fake transport, or fabricated completion fallback.

## Validation

`npm run candidate-interview-ui:contract:check` verifies the boundary and required implementation markers. The web workspace runs deterministic reducer tests without media services. Playwright additionally exercises camera denial → audio-only recovery, missing-runtime degradation, and offline → online recovery with browser fake media devices. Real LiveKit, Whisper, Silero, TTS, LLM, and end-to-end media quality remain runtime/evidence work.
