# TTS Synthesis Integration Contract v1

## Boundary

TTS is an independent component. When a TTS engine is available, synthesis does not wait for LLM, Whisper/STT, LiveKit, FFmpeg, VAD or avatar readiness. The API `TtsHttpClient.readiness()` probes only `TTS_BASE_URL/health`, and `InterviewSpeechService` does not call `InterviewMediaService.getReadiness()` before synthesis.

This independence does not weaken the speech safety boundary: the public interview-media route accepts no text. `InterviewSpeechService` loads `interview_turns.spoken_text` from PostgreSQL and requires the turn to be finalized before it can reach the TTS adapter. The existing development restriction on real-customer candidate sessions remains in force.

## HTTP contract

Source of truth: `contracts/tts-synthesis.v1.json`.

The standalone worker exposes `GET /health` and `POST /synthesize`. Successful synthesis returns `audio/wav` plus `x-tts-contract-version`, `x-request-id` and `x-tts-provider`. Requests carry the same stable request ID across bounded retries. Redirects are disabled by the API client.

The worker returns only bounded safe error codes/messages; child-process stderr and spoken text are never returned. API operational media events record bounded status metadata only and never the spoken text or audio bytes.

## Engine process boundary

`TTS_COMMAND` is parsed into argv and always executed with `shell=false` and stdin disabled. Spoken text is never interpolated into argv; it is written to an owned UTF-8 temporary file referenced by `{text_file}`. The engine writes `{output_wav}` inside the same workspace.

Each process runs in its own process group/session. Timeout uses terminate then kill escalation. stderr diagnostics are bounded and workspace paths sanitized. Output must be a valid, non-empty WAV under the maximum response size. The temporary workspace is removed after success and failure.

## Runtime evidence boundary

Scripted tests prove integration semantics without a real TTS engine. They do not prove voice quality, pronunciation, Persian/English quality, synthesis latency, CPU/GPU utilization, production throughput, voice licensing or target-engine stability. Those remain deployment-specific evidence.
