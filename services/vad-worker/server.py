from __future__ import annotations

import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from vad_layer import (
    CONTRACT_VERSION,
    MAX_AUDIO_BYTES,
    PROVIDER,
    SUPPORTED_CONTENT_TYPES,
    VADError,
    VADAnalyzer,
    normalize_request_id,
    vad_status,
)

MAX_REQUEST_BYTES = MAX_AUDIO_BYTES


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
    return os.getenv("MEDIA_WORKER_SHARED_SECRET", "").strip()


def is_authorized(handler: BaseHTTPRequestHandler) -> bool:
    expected = shared_secret()
    supplied = handler.headers.get("x-vad-secret", "") or handler.headers.get("x-media-worker-secret", "")
    return bool(expected) and hmac.compare_digest(expected, supplied)


def write_json(handler: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(data)))
    handler.send_header("cache-control", "no-store")
    handler.send_header("x-vad-contract-version", CONTRACT_VERSION)
    handler.send_header("x-provider-version", CONTRACT_VERSION)
    handler.end_headers()
    handler.wfile.write(data)


def error_payload(code: str, request_id: str, retryable: bool) -> dict[str, object]:
    safe_messages = {
        "invalid_request": "VAD request is invalid",
        "unauthorized": "VAD request is unauthorized",
        "contract_mismatch": "VAD contract version does not match",
        "payload_too_large": "VAD audio payload is too large",
        "unsupported_media_type": "VAD audio content type is unsupported",
        "invalid_audio": "VAD audio payload is invalid",
        "provider_unavailable": "Silero VAD engine is unavailable",
        "provider_error": "Silero VAD engine failed",
        "invalid_provider_output": "Silero VAD engine returned invalid segments",
        "worker_error": "VAD worker failed",
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
    server_version = "interview-vad-worker/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        # Never log raw audio, derived speech segments, request bodies or shared secrets.
        super().log_message(format, *args)

    def do_GET(self) -> None:
        if self.path != "/health":
            write_json(self, 404, {"error": "Not Found"})
            return
        status = vad_status(shared_secret=shared_secret())
        write_json(self, 200 if status["ready"] else 503, status)

    def do_POST(self) -> None:
        if self.path != "/analyze":
            write_json(self, 404, {"error": "Not Found"})
            return
        request_id = normalize_request_id(self.headers.get("x-request-id")) or "invalid-request-id"
        if not is_authorized(self):
            write_error(self, 401, "unauthorized", request_id, False)
            return
        if self.headers.get("x-vad-contract-version", "").strip() != CONTRACT_VERSION:
            write_error(self, 409, "contract_mismatch", request_id, False)
            return
        if normalize_request_id(self.headers.get("x-request-id")) is None:
            write_error(self, 400, "invalid_request", request_id, False)
            return
        content_type = self.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type not in SUPPORTED_CONTENT_TYPES:
            write_error(self, 415, "unsupported_media_type", request_id, False)
            return

        status = vad_status(shared_secret=shared_secret())
        if not status["ready"]:
            write_error(self, 503, "provider_unavailable", request_id, True)
            return

        try:
            audio = read_body(self)
        except OverflowError:
            write_error(self, 413, "payload_too_large", request_id, False)
            return
        except ValueError:
            write_error(self, 400, "invalid_request", request_id, False)
            return

        try:
            result = VADAnalyzer().analyze(audio)
        except VADError as exc:
            mapping = {
                "invalid_request": (400, False),
                "invalid_audio": (422, False),
                "provider_unavailable": (503, True),
                "provider_error": (502, True),
                "invalid_provider_output": (502, True),
            }
            http_status, retryable = mapping.get(exc.code, (500, True))
            write_error(self, http_status, exc.code, request_id, retryable)
            return
        except Exception:
            write_error(self, 500, "worker_error", request_id, True)
            return

        write_json(
            self,
            200,
            {
                "contractVersion": CONTRACT_VERSION,
                "provider": PROVIDER,
                "requestId": request_id,
                **result,
            },
        )

    def end_headers(self) -> None:
        super().end_headers()


def main() -> None:
    host = os.getenv("VAD_WORKER_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.getenv("VAD_WORKER_PORT", "9030"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"VAD worker listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
