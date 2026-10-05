# TTS Synthesis Integration Contract v1

## Boundary

TTS is an independent component. When a TTS engine is available, synthesis does not wait for LLM, Whisper/STT, LiveKit, FFmpeg, VAD or avatar readiness. The API `TtsHttpClient.readiness()` probes only `TTS_BASE_URL/health`, and `InterviewSpeechService` does not call `InterviewMediaService.getReadiness()` before synthesis.

This independence does not weaken the speech safety boundary: the public interview-media route accepts no text. `InterviewSpeechService` loads `interview_turns.spoken_text` from PostgreSQL and requires the turn to be finalized before it can reach the TTS adapter. The existing development restriction on real-customer candidate sessions remains in force.

## HTTP contract

Source of truth: `contracts/tts-synthesis.v1.json`.

The preferred local Persian runtime is the dedicated Ava-82M CPU worker on port 9022. It exposes `GET /health` and `POST /synthesize`, returns 24 kHz mono `audio/wav`, and identifies itself as `ava-82m-persian-cpu`. Edge neural TTS remains the online no-GPU fallback on port 9020 and returns `audio/mpeg`; the explicit legacy `local-command` fallback returns `audio/wav`. All successful synthesis responses include `x-tts-contract-version`, `x-request-id` and `x-tts-provider`. Requests carry the same stable request ID across bounded retries. Redirects are disabled by the API client.

The worker returns only bounded safe error codes/messages; child-process stderr and spoken text are never returned. API operational media events record bounded status metadata only and never the spoken text or audio bytes.

## Engine process boundary

The preferred Ava runtime is intentionally isolated in `.venv-ava-tts` because Ava v0.2.0 requires Python 3.11–3.13 while the rest of the workstation may use a newer Python. The worker pins the reviewed Ava v0.2.0 release, forces `device="cpu"`, keeps one model instance warm for repeated turns, uses Ava's contextual Persian G2P/pronunciation frontend, and emits validated 24 kHz mono WAV. After the model/G2P cache is populated, synthesis is local and requires no GPU.

For Ava, `InterviewSpeechService` skips the separate LLM diacritization request and sends the canonical finalized Persian text to the native G2P path. This removes a redundant pronunciation layer and reduces speech latency. Technical engineering terms still receive deterministic speech-only normalization before Ava.

The Edge fallback runs through the installed `edge-tts` Python module in-process; no CLI child process or shell is used. Its Persian voice defaults to `fa-IR-FaridNeural`, and Edge returns MP3 chunks that are collected under the response-size limit and media-signature validated. It requires network access to Microsoft's Edge speech service but no local GPU.

The explicit legacy `local-command` fallback keeps the previous `TTS_COMMAND` contract: it is parsed into argv, runs with `shell=false` and stdin disabled, receives text through `{text_file}`, and writes `{output_wav}`. The legacy child process retains terminate-then-kill timeout handling, bounded stderr diagnostics, workspace cleanup and WAV validation.

## Runtime evidence boundary

Scripted tests prove integration semantics without loading the real Ava model or calling the real Edge service. They do not prove voice quality, pronunciation quality, workstation-specific CPU latency, production throughput or long-session stability. Those remain deployment-specific evidence and should be A/B tested with representative interview questions. Ava inference is local after its model/G2P artifacts are cached. Edge TTS sends synthesized interviewer text to an external Microsoft service and is therefore kept as a fallback rather than the preferred local runtime.
