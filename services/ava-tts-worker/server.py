from __future__ import annotations

import hmac
import io
import json
import os
import re
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from fa_tech_normalizer import normalize_technical_terms

CONTRACT_VERSION = "tts-synthesis.v1"
PROVIDER = "ava-82m-persian-cpu"
MODEL_ID = "xmanii/Ava-82M"
MODEL_VERSION = "0.2.0"
CONTENT_TYPE = "audio/wav"
SAMPLE_RATE = 24_000
MAX_TEXT_CHARS = 4000
MAX_AUDIO_BYTES = 20 * 1024 * 1024
MAX_REQUEST_BYTES = 32 * 1024
DEFAULT_PORT = 9022
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")

_ENGINE: "AvaEngine | None" = None
_ENGINE_LOCK = threading.Lock()


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


def shared_secret() -> str:
    return os.getenv("TTS_SHARED_SECRET", "").strip() or os.getenv("MEDIA_WORKER_SHARED_SECRET", "").strip()


def normalize_request_id(value: str | None) -> str | None:
    candidate = (value or "").strip()
    return candidate if REQUEST_ID_PATTERN.fullmatch(candidate) else None


def validate_wav_bytes(audio: bytes) -> None:
    if len(audio) <= 44 or len(audio) > MAX_AUDIO_BYTES:
        raise RuntimeError("Ava produced empty or oversized WAV output")
    try:
        with wave.open(io.BytesIO(audio), "rb") as handle:
            if handle.getnchannels() != 1:
                raise RuntimeError("Ava WAV must be mono")
            if handle.getframerate() != SAMPLE_RATE:
                raise RuntimeError("Ava WAV sample rate mismatch")
            if handle.getnframes() <= 0:
                raise RuntimeError("Ava WAV contains no frames")
    except wave.Error as exc:
        raise RuntimeError("Ava produced invalid WAV output") from exc


class AvaEngine:
    def __init__(self) -> None:
        # Force predictable CPU-only behavior even on developer machines that happen
        # to expose CUDA. Ava itself officially supports device="cpu".
        os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
        try:
            import soundfile as sf
            import torch
            from ava_tts import Ava
        except ImportError as exc:
            raise RuntimeError(f"Ava dependency is missing: {exc.name}") from exc

        try:
            torch.set_num_threads(max(1, int(os.getenv("AVA_TTS_CPU_THREADS", str(os.cpu_count() or 1)))))
        except ValueError as exc:
            raise RuntimeError("AVA_TTS_CPU_THREADS must be an integer") from exc

        self.speed = float(os.getenv("AVA_TTS_SPEED", "1.0"))
        if not 0.7 <= self.speed <= 1.3:
            raise RuntimeError("AVA_TTS_SPEED must be between 0.7 and 1.3")

        self._soundfile = sf
        print(f"Loading Ava-82M Persian TTS {MODEL_VERSION} on CPU...", flush=True)
        self.tts = Ava.from_pretrained(MODEL_ID, device="cpu")
        print("Ava-82M Persian TTS ready · CPU · 24 kHz mono", flush=True)

    def synthesize(self, spoken_text: str) -> bytes:
        normalized = normalize_technical_terms(spoken_text.strip())
        generation = self.tts.generate(normalized, speed=self.speed)
        if generation.sample_rate != SAMPLE_RATE:
            raise RuntimeError("Ava returned an unexpected sample rate")
        output = io.BytesIO()
        self._soundfile.write(output, generation.audio, generation.sample_rate, format="WAV", subtype="PCM_16")
        audio = output.getvalue()
        validate_wav_bytes(audio)
        return audio


def is_authorized(handler: BaseHTTPRequestHandler) -> bool:
    expected = shared_secret()
    supplied = handler.headers.get("x-tts-secret", "") or handler.headers.get("x-media-worker-secret", "")
    return bool(expected) and hmac.compare_digest(expected, supplied)


def write_json(
    handler: BaseHTTPRequestHandler,
    status: int,
    payload: Any,
    *,
    request_id: str | None = None,
) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(data)))
    handler.send_header("cache-control", "no-store")
    handler.send_header("x-tts-contract-version", CONTRACT_VERSION)
    if request_id:
        handler.send_header("x-request-id", request_id)
    handler.end_headers()
    handler.wfile.write(data)


def error_payload(code: str, request_id: str, retryable: bool) -> dict[str, object]:
    messages = {
        "invalid_request": "TTS request is invalid",
        "unauthorized": "TTS request is unauthorized",
        "contract_mismatch": "TTS contract version does not match",
        "payload_too_large": "TTS request payload is too large",
        "unsupported_media_type": "TTS request content type is unsupported",
        "provider_unavailable": "TTS engine is unavailable",
        "provider_error": "TTS engine failed",
    }
    return {
        "contractVersion": CONTRACT_VERSION,
        "requestId": request_id,
        "error": {"code": code, "message": messages[code], "retryable": retryable},
    }


def write_error(
    handler: BaseHTTPRequestHandler,
    status: int,
    code: str,
    request_id: str,
    retryable: bool,
) -> None:
    write_json(handler, status, error_payload(code, request_id, retryable), request_id=request_id)


def read_body(handler: BaseHTTPRequestHandler) -> bytes:
    try:
        length = int(handler.headers.get("content-length", "0") or "0")
    except ValueError as exc:
        raise ValueError("invalid content-length") from exc
    if length <= 0:
        raise ValueError("request body is required")
    if length > MAX_REQUEST_BYTES:
        raise OverflowError("request body exceeds limit")
    body = handler.rfile.read(length)
    if len(body) != length:
        raise ValueError("incomplete request body")
    return body


def health_payload() -> dict[str, object]:
    ready = _ENGINE is not None and bool(shared_secret())
    payload: dict[str, object] = {
        "contractVersion": CONTRACT_VERSION,
        "provider": PROVIDER,
        "ready": ready,
        "device": "cpu",
        "model": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "contentType": CONTENT_TYPE,
        "sampleRate": SAMPLE_RATE,
        "maxTextChars": MAX_TEXT_CHARS,
        "maxAudioBytes": MAX_AUDIO_BYTES,
        "independentOf": ["llm", "whisper", "livekit", "ffmpeg"],
    }
    if not shared_secret():
        payload["reason"] = "TTS shared secret is not configured"
    elif _ENGINE is None:
        payload["reason"] = "Ava model is not loaded"
    return payload


class Handler(BaseHTTPRequestHandler):
    server_version = "interview-ava-tts-worker/0.2"

    def log_message(self, format: str, *args: Any) -> None:
        # Never log spoken text, request bodies, or shared secrets.
        super().log_message(format, *args)

    def do_GET(self) -> None:
        if self.path != "/health":
            write_json(self, 404, {"error": "Not Found"})
            return
        payload = health_payload()
        write_json(self, 200 if payload["ready"] else 503, payload)

    def do_POST(self) -> None:
        if self.path != "/synthesize":
            write_json(self, 404, {"error": "Not Found"})
            return

        request_id = normalize_request_id(self.headers.get("x-request-id")) or "invalid-request-id"
        if not is_authorized(self):
            write_error(self, 401, "unauthorized", request_id, False)
            return
        if self.headers.get("x-tts-contract-version", "").strip() != CONTRACT_VERSION:
            write_error(self, 409, "contract_mismatch", request_id, False)
            return
        if normalize_request_id(self.headers.get("x-request-id")) is None:
            write_error(self, 400, "invalid_request", request_id, False)
            return
        if self.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            write_error(self, 415, "unsupported_media_type", request_id, False)
            return

        try:
            payload = json.loads(read_body(self).decode("utf-8"))
        except OverflowError:
            write_error(self, 413, "payload_too_large", request_id, False)
            return
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            write_error(self, 400, "invalid_request", request_id, False)
            return

        if not isinstance(payload, dict) or set(payload) != {"spokenText"}:
            write_error(self, 400, "invalid_request", request_id, False)
            return
        spoken_text = payload.get("spokenText")
        if (
            not isinstance(spoken_text, str)
            or not spoken_text.strip()
            or len(spoken_text.strip()) > MAX_TEXT_CHARS
            or "\x00" in spoken_text
        ):
            write_error(self, 400, "invalid_request", request_id, False)
            return
        if _ENGINE is None:
            write_error(self, 503, "provider_unavailable", request_id, True)
            return

        started = time.perf_counter()
        try:
            with _ENGINE_LOCK:
                audio = _ENGINE.synthesize(spoken_text)
        except Exception as exc:
            print(
                f"Ava TTS synthesis failed · requestId={request_id} · type={type(exc).__name__}",
                flush=True,
            )
            write_error(self, 502, "provider_error", request_id, True)
            return

        duration_ms = round((time.perf_counter() - started) * 1000)
        print(
            f"Ava TTS synthesized · requestId={request_id} · bytes={len(audio)} · durationMs={duration_ms}",
            flush=True,
        )
        self.send_response(200)
        self.send_header("content-type", CONTENT_TYPE)
        self.send_header("content-length", str(len(audio)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-tts-contract-version", CONTRACT_VERSION)
        self.send_header("x-tts-provider", PROVIDER)
        self.send_header("x-request-id", request_id)
        self.end_headers()
        self.wfile.write(audio)


def main() -> None:
    global _ENGINE
    _ENGINE = AvaEngine()
    host = os.getenv("AVA_TTS_WORKER_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.getenv("AVA_TTS_WORKER_PORT", str(DEFAULT_PORT)))
    server = ThreadingHTTPServer((host, port), Handler)
    print(
        f"Ava TTS worker listening on http://{host}:{port} · provider {PROVIDER} · CPU",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
