from __future__ import annotations

import hmac
import json
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from fa_tech_normalizer import normalize_technical_terms

CONTRACT_VERSION = "tts-synthesis.v1"
PROVIDER = "ava-82m-persian-cpu"
MAX_TEXT_CHARS = 4000
MAX_REQUEST_BYTES = 32 * 1024
DEFAULT_PORT = 9022

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


class AvaEngine:
    def __init__(self) -> None:
        # This worker is intentionally CPU-only so that a CUDA-enabled workstation
        # does not silently change the benchmark or deployment characteristics.
        os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
        try:
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

        print("Loading Ava-82M Persian TTS on CPU...")
        self.tts = Ava.from_pretrained("xmanii/Ava-82M")
        print("Ava-82M Persian TTS ready")

    def synthesize(self, spoken_text: str) -> bytes:
        normalized = normalize_technical_terms(spoken_text.strip())
        with tempfile.TemporaryDirectory(prefix="interview-ava-tts-") as directory:
            output_path = Path(directory) / "speech.wav"
            self.tts.save(normalized, str(output_path), speed=self.speed)
            if not output_path.is_file() or output_path.stat().st_size <= 44:
                raise RuntimeError("Ava produced invalid WAV output")
            return output_path.read_bytes()


def is_authorized(handler: BaseHTTPRequestHandler) -> bool:
    expected = shared_secret()
    supplied = handler.headers.get("x-tts-secret", "") or handler.headers.get("x-media-worker-secret", "")
    return bool(expected) and hmac.compare_digest(expected, supplied)


def write_json(handler: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(data)))
    handler.send_header("cache-control", "no-store")
    handler.send_header("x-tts-contract-version", CONTRACT_VERSION)
    handler.end_headers()
    handler.wfile.write(data)


def read_body(handler: BaseHTTPRequestHandler) -> bytes:
    try:
        length = int(handler.headers.get("content-length", "0") or "0")
    except ValueError as exc:
        raise ValueError("invalid content-length") from exc
    if length <= 0 or length > MAX_REQUEST_BYTES:
        raise ValueError("invalid request size")
    body = handler.rfile.read(length)
    if len(body) != length:
        raise ValueError("incomplete request body")
    return body


class Handler(BaseHTTPRequestHandler):
    server_version = "interview-ava-tts-worker/0.1"

    def log_message(self, format: str, *args: Any) -> None:
        # Never log spoken text, request bodies, or shared secrets.
        super().log_message(format, *args)

    def do_GET(self) -> None:
        if self.path != "/health":
            write_json(self, 404, {"error": "Not Found"})
            return
        ready = _ENGINE is not None and bool(shared_secret())
        payload: dict[str, object] = {
            "contractVersion": CONTRACT_VERSION,
            "provider": PROVIDER,
            "ready": ready,
            "device": "cpu",
            "model": "xmanii/Ava-82M",
            "independentOf": ["llm", "whisper", "livekit", "ffmpeg"],
        }
        if not shared_secret():
            payload["reason"] = "TTS shared secret is not configured"
        write_json(self, 200 if ready else 503, payload)

    def do_POST(self) -> None:
        if self.path != "/synthesize":
            write_json(self, 404, {"error": "Not Found"})
            return
        if not is_authorized(self):
            write_json(self, 401, {"error": {"code": "unauthorized", "message": "TTS request is unauthorized"}})
            return
        if self.headers.get("x-tts-contract-version", "").strip() != CONTRACT_VERSION:
            write_json(self, 409, {"error": {"code": "contract_mismatch", "message": "TTS contract version does not match"}})
            return
        if self.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            write_json(self, 415, {"error": {"code": "unsupported_media_type", "message": "TTS request content type is unsupported"}})
            return
        try:
            payload = json.loads(read_body(self).decode("utf-8"))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            write_json(self, 400, {"error": {"code": "invalid_request", "message": "TTS request is invalid"}})
            return
        if not isinstance(payload, dict) or set(payload) != {"spokenText"}:
            write_json(self, 400, {"error": {"code": "invalid_request", "message": "TTS request is invalid"}})
            return
        spoken_text = payload.get("spokenText")
        if not isinstance(spoken_text, str) or not spoken_text.strip() or len(spoken_text.strip()) > MAX_TEXT_CHARS or "\x00" in spoken_text:
            write_json(self, 400, {"error": {"code": "invalid_request", "message": "TTS request is invalid"}})
            return
        if _ENGINE is None:
            write_json(self, 503, {"error": {"code": "provider_unavailable", "message": "TTS engine is unavailable"}})
            return
        try:
            with _ENGINE_LOCK:
                audio = _ENGINE.synthesize(spoken_text)
        except Exception:
            write_json(self, 502, {"error": {"code": "provider_error", "message": "TTS engine failed"}})
            return

        self.send_response(200)
        self.send_header("content-type", "audio/wav")
        self.send_header("content-length", str(len(audio)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-tts-contract-version", CONTRACT_VERSION)
        self.send_header("x-tts-provider", PROVIDER)
        self.end_headers()
        self.wfile.write(audio)


def main() -> None:
    global _ENGINE
    _ENGINE = AvaEngine()
    host = os.getenv("AVA_TTS_WORKER_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.getenv("AVA_TTS_WORKER_PORT", str(DEFAULT_PORT)))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Ava TTS worker listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
