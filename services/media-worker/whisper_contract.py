from __future__ import annotations

import re
import uuid
from typing import Any

CONTRACT_VERSION = "whisper-stt.v1"
PROVIDER = "whisper.cpp"
MAX_AUDIO_BYTES = 20 * 1024 * 1024
SUPPORTED_AUDIO_CONTENT_TYPES = ("audio/wav", "audio/x-wav")
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")

ERRORS: dict[str, tuple[int, bool, str]] = {
    "invalid_request": (400, False, "request is invalid"),
    "unauthorized": (401, False, "authentication failed"),
    "forbidden": (403, False, "request is forbidden"),
    "contract_mismatch": (409, False, "STT contract version does not match"),
    "payload_too_large": (413, False, "audio payload exceeds the contract limit"),
    "unsupported_media_type": (415, False, "audio content type is unsupported"),
    "invalid_audio": (422, False, "audio payload is not a valid WAV file"),
    "rate_limited": (429, True, "speech provider is rate limited"),
    "worker_error": (500, True, "speech worker failed"),
    "provider_error": (502, True, "speech provider failed"),
    "provider_unavailable": (503, True, "speech provider is unavailable"),
    "provider_timeout": (504, True, "speech provider timed out"),
}


def normalize_request_id(value: str | None) -> str | None:
    candidate = (value or "").strip()
    if not candidate or not REQUEST_ID_PATTERN.fullmatch(candidate):
        return None
    return candidate


def fallback_request_id() -> str:
    return str(uuid.uuid4())


def error_payload(code: str, request_id: str) -> dict[str, Any]:
    if code not in ERRORS:
        raise KeyError(f"unknown Whisper contract error: {code}")
    _status, retryable, message = ERRORS[code]
    return {
        "contractVersion": CONTRACT_VERSION,
        "requestId": request_id,
        "error": {
            "code": code,
            "message": message,
            "retryable": retryable,
        },
    }


def success_payload(request_id: str, result: dict[str, Any]) -> dict[str, Any]:
    text = result.get("text")
    language = result.get("language")
    if not isinstance(text, str):
        raise ValueError("Whisper result text must be a string")
    if not isinstance(language, str) or not language.strip():
        raise ValueError("Whisper result language must be a non-empty string")
    return {
        "contractVersion": CONTRACT_VERSION,
        "requestId": request_id,
        "provider": PROVIDER,
        "text": text,
        "isFinal": True,
        "language": language.strip(),
    }
