# TTS Synthesis Integration Contract v1

## Boundary

TTS is an independent component. When a TTS engine is available, synthesis does not wait for LLM, Whisper/STT, LiveKit, FFmpeg, VAD or avatar readiness. The API `TtsHttpClient.readiness()` probes only `TTS_BASE_URL/health`, and `InterviewSpeechService` does not call `InterviewMediaService.getReadiness()` before synthesis.

This independence does not weaken the speech safety boundary: the public interview-media route accepts no text. `InterviewSpeechService` loads `interview_turns.spoken_text` from PostgreSQL and requires the turn to be finalized before it can reach the TTS adapter. The existing development restriction on real-customer candidate sessions remains in force.

## HTTP contract

Source of truth: `contracts/tts-synthesis.v1.json`.

The standalone worker exposes `GET /health` and `POST /synthesize`. The default Edge neural engine returns `audio/mpeg`; the explicit legacy `local-command` fallback returns `audio/wav`. Both responses include `x-tts-contract-version`, `x-request-id` and `x-tts-provider`. Requests carry the same stable request ID across bounded retries. Redirects are disabled by the API client.

The worker returns only bounded safe error codes/messages; child-process stderr and spoken text are never returned. API operational media events record bounded status metadata only and never the spoken text or audio bytes.

## Engine process boundary

The default `edge-tts` engine is invoked with `shell=false`. Spoken text is kept off argv: it is written to an owned UTF-8 temporary file and supplied through Edge TTS's `--file` option. The configured Persian voice defaults to `fa-IR-FaridNeural`, and Edge returns MP3. No local GPU, FFmpeg, Whisper or LiveKit dependency is required for synthesis, although network access to the Edge speech service is required.

The explicit legacy `local-command` fallback keeps the previous `TTS_COMMAND` contract: it is parsed into argv, runs with `shell=false` and stdin disabled, receives text through `{text_file}`, and writes `{output_wav}`.

Each child process runs in its own process group/session. Timeout uses terminate then kill escalation. stderr diagnostics are bounded and workspace paths sanitized. Output is media-signature validated and bounded by the maximum response size. The temporary workspace is removed after success and failure.

## Runtime evidence boundary

Scripted tests prove integration semantics without calling the real Edge service. They do not prove voice quality, pronunciation, Persian/English quality, synthesis latency, network availability, production throughput, service-policy stability or external-provider privacy suitability. Those remain deployment-specific evidence. Edge TTS sends the synthesized interviewer text to an external Microsoft service; deployments that prohibit that must use the local-command fallback or another approved provider.
