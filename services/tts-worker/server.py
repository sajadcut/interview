from __future__ import annotations

import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from tts_layer import (
    CONTRACT_VERSION,
    MAX_AUDIO_BYTES,
    MAX_TEXT_CHARS,
    PROVIDER,
    TTSError,
    TTSProcessRunner,
    normalize_request_id,
    tts_status,
)

MAX_REQUEST_BYTES = 32 * 1024


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


def error_payload(code: str, request_id: str, retryable: bool) -> dict[str, object]:
    safe_messages = {
        "invalid_request": "TTS request is invalid",
        "unauthorized": "TTS request is unauthorized",
        "contract_mismatch": "TTS contract version does not match",
        "payload_too_large": "TTS request payload is too large",
        "unsupported_media_type": "TTS request content type is unsupported",
        "provider_unavailable": "TTS engine is unavailable",
        "provider_timeout": "TTS engine timed out",
        "provider_error": "TTS engine failed",
        "invalid_audio_output": "TTS engine produced invalid audio",
        "worker_error": "TTS worker failed",
    }
    return {
        "contractVersion": CONTRACT_VERSION,
        "requestId": request_id,
        "error": {"code": code, "message": safe_messages[code], "retryable": retryable},
    }


def write_error(handler: BaseHTTPRequestHandler, status: int, code: str, request_id: str, retryable: bool) -> None:
    write_json(handler, status, error_payload(code, request_id, retryable))


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
        raise ValueError("request body ended before content-length")
    return body


class Handler(BaseHTTPRequestHandler):
    server_version = "interview-tts-worker/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        # Never log spoken text, request bodies, command diagnostics or shared secrets.
        super().log_message(format, *args)

    def do_GET(self) -> None:
        if self.path != "/health":
            write_json(self, 404, {"error": "Not Found"})
            return
        status = tts_status(shared_secret=shared_secret())
        write_json(self, 200 if status["ready"] else 503, status)

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
        content_type = self.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            write_error(self, 415, "unsupported_media_type", request_id, False)
            return
        status = tts_status(shared_secret=shared_secret())
        if not status["ready"]:
            write_error(self, 503, "provider_unavailable", request_id, True)
            return

        try:
            raw = read_body(self)
        except OverflowError:
            write_error(self, 413, "payload_too_large", request_id, False)
            return
        except ValueError:
            write_error(self, 400, "invalid_request", request_id, False)
            return
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
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

        try:
            audio = TTSProcessRunner().synthesize(spoken_text)
        except TTSError as exc:
            mapping = {
                "invalid_request": (400, False),
                "not_configured": (503, True),
                "provider_unavailable": (503, True),
                "provider_timeout": (504, True),
                "provider_error": (502, True),
                "invalid_audio_output": (502, True),
            }
            http_status, retryable = mapping.get(exc.code, (500, True))
            code = "provider_unavailable" if exc.code == "not_configured" else exc.code
            write_error(self, http_status, code, request_id, retryable)
            return
        except Exception:
            write_error(self, 500, "worker_error", request_id, True)
            return

        if len(audio) > MAX_AUDIO_BYTES:
            write_error(self, 502, "invalid_audio_output", request_id, True)
            return
        self.send_response(200)
        self.send_header("content-type", "audio/wav")
        self.send_header("content-length", str(len(audio)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-tts-contract-version", CONTRACT_VERSION)
        self.send_header("x-tts-provider", PROVIDER)
        self.send_header("x-request-id", request_id)
        self.end_headers()
        self.wfile.write(audio)


def main() -> None:
    host = os.getenv("TTS_WORKER_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.getenv("TTS_WORKER_PORT", "9020"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"TTS worker listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
