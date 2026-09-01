from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

MAX_AUDIO_BYTES = 20 * 1024 * 1024


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


def vad_status() -> dict[str, Any]:
    try:
        import silero_vad  # type: ignore

        version = getattr(silero_vad, "__version__", "unknown")
        return {"ready": True, "provider": "silero-vad", "version": str(version)}
    except Exception as exc:
        return {"ready": False, "provider": "silero-vad", "reason": f"silero_vad unavailable: {exc}"}


def stt_status() -> dict[str, Any]:
    command = resolve_command(os.getenv("WHISPER_CLI", "whisper-cli"))
    model = os.getenv("WHISPER_MODEL_PATH", "").strip()
    if not command:
        return {"ready": False, "provider": "whisper.cpp", "reason": "WHISPER_CLI not found"}
    if not model or not Path(model).is_file():
        return {"ready": False, "provider": "whisper.cpp", "reason": "WHISPER_MODEL_PATH is missing or not a file"}
    return {"ready": True, "provider": "whisper.cpp", "command": Path(command).name, "modelConfigured": True}


def tts_status() -> dict[str, Any]:
    template = os.getenv("TTS_COMMAND", "").strip()
    if not template:
        return {"ready": False, "provider": "local-command", "reason": "TTS_COMMAND is not configured"}
    parts = shlex.split(template, posix=os.name != "nt")
    command = resolve_command(parts[0]) if parts else None
    if not command:
        return {"ready": False, "provider": "local-command", "reason": "TTS command executable not found"}
    if "{text_file}" not in template or "{output_wav}" not in template:
        return {"ready": False, "provider": "local-command", "reason": "TTS_COMMAND must contain {text_file} and {output_wav}"}
    return {"ready": True, "provider": "local-command", "command": Path(command).name}


def write_json(handler: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(data)))
    handler.send_header("cache-control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


def read_audio_body(handler: BaseHTTPRequestHandler) -> bytes:
    length = int(handler.headers.get("content-length", "0") or "0")
    if length <= 0:
        raise ValueError("audio body is required")
    if length > MAX_AUDIO_BYTES:
        raise ValueError(f"audio body exceeds {MAX_AUDIO_BYTES} bytes")
    body = handler.rfile.read(length)
    if len(body) != length:
        raise ValueError("audio body ended before content-length")
    return body


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
            stderr = (result.stderr or "").strip()[-1000:]
            raise RuntimeError(f"whisper-cli did not produce transcript output: {stderr or 'no output file'}")
        text = output_file.read_text(encoding="utf-8").strip()
        return {"text": text, "isFinal": True, "language": language, "provider": "whisper.cpp"}


class Handler(BaseHTTPRequestHandler):
    server_version = "interview-media-worker/0.1"

    def log_message(self, format: str, *args: Any) -> None:
        # Paths/status only; never log request bodies or transcript text.
        super().log_message(format, *args)

    def do_GET(self) -> None:
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
            write_json(self, 200 if status["ready"] else 503, status)
            return
        if self.path == "/tts/health":
            status = tts_status()
            write_json(self, 200 if status["ready"] else 503, status)
            return
        write_json(self, 404, {"error": "Not Found"})

    def do_POST(self) -> None:
        try:
            if self.path == "/vad/analyze":
                status = vad_status()
                if not status["ready"]:
                    write_json(self, 503, status)
                    return
                write_json(self, 200, run_vad(read_audio_body(self)))
                return
            if self.path == "/stt/finalize":
                status = stt_status()
                if not status["ready"]:
                    write_json(self, 503, status)
                    return
                write_json(self, 200, run_whisper(read_audio_body(self)))
                return
            write_json(self, 404, {"error": "Not Found"})
        except ValueError as exc:
            write_json(self, 400, {"error": "Bad Request", "message": str(exc)})
        except subprocess.TimeoutExpired:
            write_json(self, 504, {"error": "Gateway Timeout", "message": "speech provider timed out"})
        except Exception as exc:
            write_json(self, 500, {"error": "Worker Error", "message": str(exc)[:1000]})


if __name__ == "__main__":
    host = os.getenv("MEDIA_WORKER_HOST", "127.0.0.1")
    port = int(os.getenv("MEDIA_WORKER_PORT", "9010"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"interview-media-worker listening on http://{host}:{port}")
    server.serve_forever()
