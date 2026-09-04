from __future__ import annotations

import hmac
import io
import json
import os
import shlex
import shutil
import subprocess
import tempfile
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from realtime_metrics import REGISTRY, record_whisper_request, refresh_component_readiness
from whisper_contract import (
    CONTRACT_VERSION as WHISPER_CONTRACT_VERSION,
    ERRORS as WHISPER_ERRORS,
    MAX_AUDIO_BYTES,
    PROVIDER as WHISPER_PROVIDER,
    SUPPORTED_AUDIO_CONTENT_TYPES,
    error_payload as whisper_error_payload,
    fallback_request_id,
    normalize_request_id,
    success_payload as whisper_success_payload,
)

MAX_TTS_TEXT_CHARS = 4000


def load_root_env() -> None:
    candidates = [Path.cwd() / ".env", Path(__file__).resolve().parents[2] / ".env"]
    for candidate in candidates:
        if not candidate.exists():
            continue
        for raw_line in candidate.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
        return


load_root_env()


def resolve_command(value: str) -> str | None:
    candidate = value.strip()
    if not candidate:
        return None
    direct = Path(candidate)
    if direct.exists():
        return str(direct)
    return shutil.which(candidate)


def worker_secret_ready() -> bool:
    return bool(os.getenv("MEDIA_WORKER_SHARED_SECRET", "").strip())


def livekit_ready() -> bool:
    if os.getenv("MEDIA_TRANSPORT_PROVIDER", "disabled").strip().lower() != "livekit":
        return False
    return all(os.getenv(name, "").strip() for name in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"))


def ffmpeg_ready() -> bool:
    return resolve_command(os.getenv("FFMPEG_CLI", "ffmpeg")) is not None


def vad_status() -> dict[str, Any]:
    if not worker_secret_ready():
        return {"ready": False, "provider": "silero-vad", "reason": "MEDIA_WORKER_SHARED_SECRET is not configured"}
    try:
        import silero_vad  # type: ignore

        version = getattr(silero_vad, "__version__", "unknown")
        return {"ready": True, "provider": "silero-vad", "version": str(version)}
    except Exception as exc:
        return {"ready": False, "provider": "silero-vad", "reason": f"silero_vad unavailable: {exc}"}


def stt_status() -> dict[str, Any]:
    base = {
        "contractVersion": WHISPER_CONTRACT_VERSION,
        "provider": WHISPER_PROVIDER,
        "maxAudioBytes": MAX_AUDIO_BYTES,
        "supportedContentTypes": list(SUPPORTED_AUDIO_CONTENT_TYPES),
    }
    if not worker_secret_ready():
        return {**base, "ready": False, "reason": "MEDIA_WORKER_SHARED_SECRET is not configured"}
    command = resolve_command(os.getenv("WHISPER_CLI", "whisper-cli"))
    model = os.getenv("WHISPER_MODEL_PATH", "").strip()
    if not command:
        return {**base, "ready": False, "reason": "WHISPER_CLI not found"}
    if not model or not Path(model).is_file():
        return {**base, "ready": False, "reason": "WHISPER_MODEL_PATH is missing or not a file"}
    return {
        **base,
        "ready": True,
        "command": Path(command).name,
        "modelConfigured": True,
    }


def tts_status() -> dict[str, Any]:
    template = os.getenv("TTS_COMMAND", "").strip()
    if not worker_secret_ready():
        return {"ready": False, "provider": "local-command", "reason": "MEDIA_WORKER_SHARED_SECRET is not configured"}
    if not template:
        return {"ready": False, "provider": "local-command", "reason": "TTS_COMMAND is not configured"}
    parts = shlex.split(template, posix=os.name != "nt")
    command = resolve_command(parts[0]) if parts else None
    if not command:
        return {"ready": False, "provider": "local-command", "reason": "TTS command executable not found"}
    if "{text_file}" not in template or "{output_wav}" not in template:
        return {"ready": False, "provider": "local-command", "reason": "TTS_COMMAND must contain {text_file} and {output_wav}"}
    return {"ready": True, "provider": "local-command", "command": Path(command).name}


def refresh_realtime_readiness() -> None:
    refresh_component_readiness(
        livekit_ready=livekit_ready(),
        whisper_ready=bool(stt_status()["ready"]),
        ffmpeg_ready=ffmpeg_ready(),
    )


def write_json(handler: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(data)))
    handler.send_header("cache-control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


def write_stt_json(handler: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(data)))
    handler.send_header("cache-control", "no-store")
    handler.send_header("x-stt-contract-version", WHISPER_CONTRACT_VERSION)
    handler.end_headers()
    handler.wfile.write(data)


def write_stt_error(handler: BaseHTTPRequestHandler, code: str, request_id: str) -> None:
    status, _retryable, _message = WHISPER_ERRORS[code]
    write_stt_json(handler, status, whisper_error_payload(code, request_id))


def write_metrics(handler: BaseHTTPRequestHandler) -> None:
    refresh_realtime_readiness()
    data = REGISTRY.render().encode("utf-8")
    handler.send_response(200)
    handler.send_header("content-type", "text/plain; version=0.0.4; charset=utf-8")
    handler.send_header("content-length", str(len(data)))
    handler.send_header("cache-control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


def read_body(handler: BaseHTTPRequestHandler, maximum: int) -> bytes:
    length = int(handler.headers.get("content-length", "0") or "0")
    if length <= 0:
        raise ValueError("request body is required")
    if length > maximum:
        raise OverflowError("request body exceeds limit")
    body = handler.rfile.read(length)
    if len(body) != length:
        raise ValueError("request body ended before content-length")
    return body


def is_authorized(handler: BaseHTTPRequestHandler) -> bool:
    expected = os.getenv("MEDIA_WORKER_SHARED_SECRET", "").strip()
    supplied = handler.headers.get("x-media-worker-secret", "")
    return bool(expected) and hmac.compare_digest(expected, supplied)


def wav_duration_seconds(audio_bytes: bytes) -> float | None:
    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as audio:
            frame_rate = audio.getframerate()
            frame_count = audio.getnframes()
            if frame_rate <= 0 or frame_count < 0:
                return None
            return frame_count / frame_rate
    except (EOFError, wave.Error):
        return None


def valid_wav(audio_bytes: bytes) -> bool:
    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as audio:
            return audio.getnchannels() > 0 and audio.getsampwidth() > 0 and audio.getframerate() > 0
    except (EOFError, wave.Error):
        return False


def run_vad(audio_bytes: bytes) -> dict[str, Any]:
    from silero_vad import get_speech_timestamps, load_silero_vad, read_audio  # type: ignore

    with tempfile.TemporaryDirectory(prefix="interview-vad-") as directory:
        audio_path = Path(directory) / "input.wav"
        audio_path.write_bytes(audio_bytes)
        model = load_silero_vad()
        wav = read_audio(str(audio_path), sampling_rate=16000)
        segments = get_speech_timestamps(wav, model, sampling_rate=16000, return_seconds=True)
        normalized = [
            {"startSeconds": float(item["start"]), "endSeconds": float(item["end"])}
            for item in segments
        ]
        return {"speechDetected": bool(normalized), "segments": normalized, "sampleRate": 16000}


def run_whisper(audio_bytes: bytes) -> dict[str, Any]:
    command = resolve_command(os.getenv("WHISPER_CLI", "whisper-cli"))
    model = os.getenv("WHISPER_MODEL_PATH", "").strip()
    language = os.getenv("WHISPER_LANGUAGE", "auto").strip() or "auto"
    timeout_seconds = int(os.getenv("WHISPER_TIMEOUT_SECONDS", "120"))
    if not command or not model:
        raise RuntimeError("whisper.cpp is not configured")

    started_at = time.perf_counter()
    audio_duration = wav_duration_seconds(audio_bytes)
    result_label = "error"
    transcript_text = ""
    try:
        with tempfile.TemporaryDirectory(prefix="interview-stt-") as directory:
            root = Path(directory)
            audio_path = root / "input.wav"
            output_prefix = root / "transcript"
            audio_path.write_bytes(audio_bytes)
            result = subprocess.run(
                [
                    command,
                    "-m",
                    model,
                    "-f",
                    str(audio_path),
                    "--output-txt",
                    "--output-file",
                    str(output_prefix),
                    "--no-prints",
                    "--language",
                    language,
                ],
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                check=False,
            )
            output_file = output_prefix.with_suffix(".txt")
            if result.returncode != 0 or not output_file.exists():
                raise RuntimeError("whisper-cli failed to produce transcript output")
            transcript_text = output_file.read_text(encoding="utf-8").strip()
            result_label = "success"
            return {"text": transcript_text, "isFinal": True, "language": language, "provider": WHISPER_PROVIDER}
    except subprocess.TimeoutExpired:
        result_label = "timeout"
        raise
    finally:
        record_whisper_request(
            result=result_label,
            processing_duration_seconds=max(0.0, time.perf_counter() - started_at),
            audio_duration_seconds=audio_duration,
            empty_transcript=result_label == "success" and not transcript_text,
        )


def run_tts(spoken_text: str) -> bytes:
    template = os.getenv("TTS_COMMAND", "").strip()
    if not template:
        raise RuntimeError("TTS_COMMAND is not configured")
    timeout_seconds = int(os.getenv("TTS_TIMEOUT_SECONDS", "60"))

    with tempfile.TemporaryDirectory(prefix="interview-tts-") as directory:
        root = Path(directory)
        text_file = root / "spoken.txt"
        output_wav = root / "speech.wav"
        text_file.write_text(spoken_text, encoding="utf-8")
        tokens = shlex.split(template, posix=os.name != "nt")
        if not tokens:
            raise RuntimeError("TTS_COMMAND is empty")
        command = resolve_command(tokens[0])
        if not command:
            raise RuntimeError("TTS command executable not found")
        args = [
            command,
            *[
                token.replace("{text_file}", str(text_file)).replace("{output_wav}", str(output_wav))
                for token in tokens[1:]
            ],
        ]
        result = subprocess.run(args, capture_output=True, timeout=timeout_seconds, check=False)
        if result.returncode != 0 or not output_wav.is_file() or output_wav.stat().st_size == 0:
            raise RuntimeError("TTS command did not produce WAV output")
        return output_wav.read_bytes()


class Handler(BaseHTTPRequestHandler):
    server_version = "interview-media-worker/0.4"

    def log_message(self, format: str, *args: Any) -> None:
        # Paths/status only; never log request bodies, transcript text, spoken text or credentials.
        super().log_message(format, *args)

    def do_GET(self) -> None:
        if self.path == "/metrics":
            write_metrics(self)
            return
        if self.path == "/health":
            components = {"vad": vad_status(), "stt": stt_status(), "tts": tts_status()}
            ready = all(item["ready"] for item in components.values())
            write_json(self, 200 if ready else 503, {"service": "interview-media-worker", "ready": ready, "components": components})
            return
        if self.path == "/vad/health":
            status = vad_status()
            write_json(self, 200 if status["ready"] else 503, status)
            return
        if self.path == "/stt/health":
            status = stt_status()
            write_stt_json(self, 200 if status["ready"] else 503, status)
            return
        if self.path == "/tts/health":
            status = tts_status()
            write_json(self, 200 if status["ready"] else 503, status)
            return
        write_json(self, 404, {"error": "Not Found"})

    def do_POST(self) -> None:
        if self.path == "/stt/finalize":
            request_id = normalize_request_id(self.headers.get("x-request-id")) or fallback_request_id()
            if not is_authorized(self):
                write_stt_error(self, "unauthorized", request_id)
                return
            if self.headers.get("x-stt-contract-version", "").strip() != WHISPER_CONTRACT_VERSION:
                write_stt_error(self, "contract_mismatch", request_id)
                return
            if normalize_request_id(self.headers.get("x-request-id")) is None:
                write_stt_error(self, "invalid_request", request_id)
                return
            content_type = self.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            if content_type not in SUPPORTED_AUDIO_CONTENT_TYPES:
                write_stt_error(self, "unsupported_media_type", request_id)
                return
            status = stt_status()
            if not status["ready"]:
                record_whisper_request(result="unavailable", processing_duration_seconds=0, audio_duration_seconds=None)
                write_stt_error(self, "provider_unavailable", request_id)
                return
            try:
                audio = read_body(self, MAX_AUDIO_BYTES)
            except OverflowError:
                write_stt_error(self, "payload_too_large", request_id)
                return
            except ValueError:
                write_stt_error(self, "invalid_request", request_id)
                return
            if not valid_wav(audio):
                write_stt_error(self, "invalid_audio", request_id)
                return
            try:
                result = run_whisper(audio)
                write_stt_json(self, 200, whisper_success_payload(request_id, result))
            except subprocess.TimeoutExpired:
                write_stt_error(self, "provider_timeout", request_id)
            except RuntimeError:
                write_stt_error(self, "provider_error", request_id)
            except Exception:
                write_stt_error(self, "worker_error", request_id)
            return

        if not is_authorized(self):
            write_json(self, 401, {"error": "Unauthorized"})
            return
        try:
            if self.path == "/vad/analyze":
                status = vad_status()
                if not status["ready"]:
                    write_json(self, 503, status)
                    return
                write_json(self, 200, run_vad(read_body(self, MAX_AUDIO_BYTES)))
                return
            if self.path == "/tts/synthesize":
                status = tts_status()
                if not status["ready"]:
                    write_json(self, 503, status)
                    return
                payload = json.loads(read_body(self, 32 * 1024).decode("utf-8"))
                spoken_text = payload.get("spokenText") if isinstance(payload, dict) else None
                if not isinstance(spoken_text, str) or not spoken_text.strip():
                    raise ValueError("spokenText is required")
                spoken_text = spoken_text.strip()
                if len(spoken_text) > MAX_TTS_TEXT_CHARS:
                    raise ValueError(f"spokenText exceeds {MAX_TTS_TEXT_CHARS} characters")
                audio = run_tts(spoken_text)
                self.send_response(200)
                self.send_header("content-type", "audio/wav")
                self.send_header("content-length", str(len(audio)))
                self.send_header("cache-control", "no-store")
                self.end_headers()
                self.wfile.write(audio)
                return
            write_json(self, 404, {"error": "Not Found"})
        except json.JSONDecodeError:
            write_json(self, 400, {"error": "Bad Request", "message": "valid JSON body is required"})
        except ValueError as exc:
            write_json(self, 400, {"error": "Bad Request", "message": str(exc)})
        except OverflowError:
            write_json(self, 413, {"error": "Payload Too Large"})
        except subprocess.TimeoutExpired:
            write_json(self, 504, {"error": "Gateway Timeout", "message": "speech provider timed out"})
        except Exception:
            write_json(self, 500, {"error": "Worker Error", "message": "media worker request failed"})


if __name__ == "__main__":
    host = os.getenv("MEDIA_WORKER_HOST", "127.0.0.1")
    port = int(os.getenv("MEDIA_WORKER_PORT", "9010"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"interview-media-worker listening on http://{host}:{port}")
    server.serve_forever()
