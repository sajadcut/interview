# Candidate Interview UI Contract v1

`/candidate/interview` is the real candidate-facing interview room. It is deliberately separate from recruiter/internal media controls and from the engineering harness.

The candidate flow is:

`/candidate/invitation` → verified candidate session → `/candidate/setup` → persisted consent and device readiness → `/candidate/interview`.

## Security boundary

The page is entered only after the cookie-backed candidate session and persisted candidate consent checks pass. Candidate browser code must not call recruiter/tenant media endpoints, send `x-organization-id` or `x-user-id`, or reuse internal engineering-harness credentials.

The page creates a candidate-scoped realtime runtime and injects it into `CandidateInterviewExperience`. Browser requests go through the same-origin `/api/candidate-interview` proxy, which forwards the candidate cookie to the dedicated `/v1/candidate-interview` API. The API resolves organization/application/candidate scope from the candidate session; it does not trust tenant headers from the browser.

The UI never renders a fake live state. It enters `live` only after the candidate runtime successfully starts the server runtime and connects to LiveKit.

## Candidate room

Before start, the candidate sees only readiness controls: local camera preview, microphone/camera controls, audio-only fallback, and **Start interview**. Engineering controls such as `Start answer` and `Stop answer` are not part of this surface.

After the secure realtime connection succeeds, the room shows:

- a primary remote interviewer video surface;
- the candidate camera as a local picture-in-picture preview;
- remote interviewer audio when a remote audio track exists;
- server-generated interviewer turn audio from the finalized persisted Brain turn;
- a **Replay question** action;
- typed answers in the same room;
- voice answers in the same room;
- mute, camera, and speaker controls;
- the finalized conversation transcript.

The current interviewer is audio-first. Until the avatar worker publishes a remote video track, the interviewer surface shows an explicit audio-interviewer placeholder rather than fabricated video. When an avatar participant joins the same LiveKit room, its remote interviewer video is attached automatically.

## Voice answers

Voice capture starts with one candidate action. There is no separate stop-answer control. Browser audio is captured as mono PCM, downsampled to 16 kHz WAV, and automatically submitted after speech followed by a short silence, with a bounded maximum answer duration.

The candidate-scoped API sends authenticated candidate audio through the existing VAD/STT path. Only a usable final transcript advances the Brain. Raw candidate audio is not persisted by this UI or API path.

## Typed answers

Typed answers use the same interview session, media session, Brain turn progression, and transcript persistence as spoken answers. Text entered by the candidate is treated as candidate evidence; it cannot supply or override interviewer `spoken_text`.

## Interviewer audio invariant

TTS for the candidate room is requested by `turnId`, not by arbitrary browser-supplied text. The server resolves that turn from the persisted interview state and synthesizes the finalized interviewer `spoken_text`. This preserves the evidence/Brain boundary and prevents the browser from changing what the interviewer says.

## State model

The reducer owns the explicit states `permissions`, `ready`, `connecting`, `live`, `reconnecting`, `offline`, `degraded`, `fatal`, and `completed`.

Only a runtime `CONNECTED` event can move the UI to `live`. Browser offline state preserves the secure session. A connected room remains the candidate's room while reconnecting or offline, but answer controls are disabled until the secure transport is live again. Reconnect attempts are bounded at three, after which the UI degrades to the resume-later fallback instead of looping forever.

Session expiry and missing consent are fatal. Permission, device, network, runtime, and transport failures are recoverable.

## Media permissions and privacy

Camera and microphone capture is requested only after an explicit candidate action. Microphone permission is mandatory. If camera access is denied or unavailable, the candidate can explicitly select audio-only mode; audio-only still requires a live microphone track.

The local preview is not persisted. This UI does not perform biometric analysis or infer emotion, truthfulness, personality, or job fit from video/audio. Candidates can mute their microphone or disable camera tracks locally.

## Validation

`npm run candidate-interview-ui:contract:check` verifies candidate runtime wiring, the same-origin security boundary, candidate-scoped API endpoints, remote interviewer video/audio surfaces, typed answers, voice answers, silence auto-submit, finalized-turn TTS, and the absence of engineering answer controls.

Reducer tests remain deterministic and do not require realtime services. Playwright covers candidate authentication/setup, camera denial → audio-only recovery, **Start interview** availability, and offline → online session preservation without requiring a real LiveKit/Whisper/Silero/TTS/LLM stack in CI.
