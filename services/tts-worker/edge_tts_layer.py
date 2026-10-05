from __future__ import annotations

import asyncio
import os
from typing import Any

from tts_layer import (
    CONTRACT_VERSION,
    MAX_AUDIO_BYTES,
    MAX_TEXT_CHARS,
    TTSError,
    bounded_float,
    normalize_persian_spoken_text,
)

try:
    import edge_tts as edge_tts_module
except Exception:
    # Keep the worker bootable so /health can explain a missing/broken optional
    # dependency instead of crashing the complete local stack.
    edge_tts_module = None

PROVIDER = "edge-tts"
CONTENT_TYPE = "audio/mpeg"
DEFAULT_VOICE = "fa-IR-FaridNeural"
DEFAULT_TIMEOUT_SECONDS = 60.0
MIN_TIMEOUT_SECONDS = 0.05
MAX_TIMEOUT_SECONDS = 300.0


def _validated_voice(value: str) -> str:
    voice = value.strip()
    if not voice or len(voice) > 128:
        raise TTSError("not_configured", diagnostic="TTS_EDGE_VOICE is invalid")
    return voice


def _validated_prosody(value: str, name: str, suffix: str) -> str:
    candidate = value.strip()
    if not candidate or len(candidate) > 16 or not candidate.endswith(suffix):
        raise TTSError("not_configured", diagnostic=f"{name} is invalid")
    return candidate


def validate_mp3_bytes(audio: bytes) -> None:
    if len(audio) <= 128 or len(audio) > MAX_AUDIO_BYTES:
        raise TTSError("invalid_audio_output", diagnostic="MP3 output is empty or oversized")
    if audio.startswith(b"ID3"):
        return
    probe = audio[:4096]
    for index in range(max(0, len(probe) - 1)):
        if probe[index] == 0xFF and probe[index + 1] & 0xE0 == 0xE0:
            return
    raise TTSError("invalid_audio_output", diagnostic="output is not a valid MP3 stream")


class EdgeTTSRunner:
    def __init__(
        self,
        *,
        voice: str | None = None,
        rate: str | None = None,
        volume: str | None = None,
        pitch: str | None = None,
        proxy: str | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        if edge_tts_module is None:
            raise TTSError("provider_unavailable", diagnostic="edge-tts Python package is unavailable")

        self.voice = _validated_voice(voice if voice is not None else os.getenv("TTS_EDGE_VOICE", DEFAULT_VOICE))
        self.rate = _validated_prosody(
            rate if rate is not None else os.getenv("TTS_EDGE_RATE", "+0%"),
            "TTS_EDGE_RATE",
            "%",
        )
        self.volume = _validated_prosody(
            volume if volume is not None else os.getenv("TTS_EDGE_VOLUME", "+0%"),
            "TTS_EDGE_VOLUME",
            "%",
        )
        self.pitch = _validated_prosody(
            pitch if pitch is not None else os.getenv("TTS_EDGE_PITCH", "+0Hz"),
            "TTS_EDGE_PITCH",
            "Hz",
        )
        configured_proxy = proxy if proxy is not None else os.getenv("TTS_EDGE_PROXY", "")
        self.proxy = configured_proxy.strip() or None
        timeout = timeout_seconds if timeout_seconds is not None else os.getenv(
            "TTS_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)
        )
        self.timeout_seconds = bounded_float(
            timeout,
            MIN_TIMEOUT_SECONDS,
            MAX_TIMEOUT_SECONDS,
            "TTS_TIMEOUT_SECONDS",
        )

    async def _collect_audio(self, spoken_text: str) -> bytes:
        assert edge_tts_module is not None
        request_timeout = max(1, min(60, int(self.timeout_seconds)))
        communicate = edge_tts_module.Communicate(
            spoken_text,
            self.voice,
            rate=self.rate,
            volume=self.volume,
            pitch=self.pitch,
            proxy=self.proxy,
            connect_timeout=max(1, min(10, request_timeout)),
            receive_timeout=request_timeout,
        )
        audio = bytearray()
        async for chunk in communicate.stream():
            if chunk.get("type") != "audio":
                continue
            data: Any = chunk.get("data")
            if not isinstance(data, (bytes, bytearray)):
                raise TTSError("invalid_audio_output", diagnostic="Edge TTS returned invalid audio data")
            audio.extend(data)
            if len(audio) > MAX_AUDIO_BYTES:
                raise TTSError("invalid_audio_output", diagnostic="Edge TTS audio exceeds response limit")
        return bytes(audio)

    def synthesize(self, spoken_text: str) -> bytes:
        if not isinstance(spoken_text, str):
            raise TTSError("invalid_request")
        normalized = normalize_persian_spoken_text(spoken_text.strip())
        if not normalized or len(normalized) > MAX_TEXT_CHARS or "\x00" in normalized:
            raise TTSError("invalid_request")

        try:
            audio = asyncio.run(
                asyncio.wait_for(
                    self._collect_audio(normalized),
                    timeout=self.timeout_seconds,
                )
            )
        except TimeoutError as exc:
            raise TTSError("provider_timeout", diagnostic="Edge TTS request timed out") from exc
        except TTSError:
            raise
        except Exception as exc:
            # Do not copy provider exception text here because it may contain request
            # material. The exception class is enough for local diagnostics.
            raise TTSError(
                "provider_error",
                diagnostic=f"Edge TTS request failed ({type(exc).__name__})",
            ) from exc

        validate_mp3_bytes(audio)
        return audio


def edge_tts_status(
    *,
    shared_secret: str | None = None,
    module_available: bool | None = None,
) -> dict[str, object]:
    secret = shared_secret if shared_secret is not None else (
        os.getenv("TTS_SHARED_SECRET", "").strip() or os.getenv("MEDIA_WORKER_SHARED_SECRET", "").strip()
    )
    base: dict[str, object] = {
        "contractVersion": CONTRACT_VERSION,
        "provider": PROVIDER,
        "contentType": CONTENT_TYPE,
        "voice": os.getenv("TTS_EDGE_VOICE", DEFAULT_VOICE).strip() or DEFAULT_VOICE,
        "maxTextChars": MAX_TEXT_CHARS,
        "maxAudioBytes": MAX_AUDIO_BYTES,
        "independentOf": ["llm", "whisper", "livekit", "ffmpeg"],
    }
    if not secret:
        return {**base, "ready": False, "reason": "TTS shared secret is not configured"}

    available = edge_tts_module is not None if module_available is None else module_available
    if not available:
        return {**base, "ready": False, "reason": "edge-tts Python package is unavailable"}

    try:
        _validated_voice(os.getenv("TTS_EDGE_VOICE", DEFAULT_VOICE))
        _validated_prosody(os.getenv("TTS_EDGE_RATE", "+0%"), "TTS_EDGE_RATE", "%")
        _validated_prosody(os.getenv("TTS_EDGE_VOLUME", "+0%"), "TTS_EDGE_VOLUME", "%")
        _validated_prosody(os.getenv("TTS_EDGE_PITCH", "+0Hz"), "TTS_EDGE_PITCH", "Hz")
    except TTSError as exc:
        return {**base, "ready": False, "reason": str(exc)}
    return {**base, "ready": True, "runtime": "python-module"}
