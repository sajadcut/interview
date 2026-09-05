from __future__ import annotations

import io
import math
import os
import re
import tempfile
import threading
import wave
from pathlib import Path
from typing import Any, Protocol

CONTRACT_VERSION = "silero-vad.v1"
PROVIDER = "silero-vad"
SUPPORTED_CONTENT_TYPES = ("audio/wav", "audio/x-wav")
MAX_AUDIO_BYTES = 20 * 1024 * 1024
MAX_AUDIO_SECONDS = 300.0
MAX_SEGMENTS = 1000
TARGET_SAMPLE_RATE = 16000
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")

_SAFE_MESSAGES = {
    "invalid_request": "VAD request is invalid",
    "invalid_audio": "VAD audio payload is invalid",
    "provider_unavailable": "Silero VAD engine is unavailable",
    "provider_error": "Silero VAD engine failed",
    "invalid_provider_output": "Silero VAD engine returned invalid segments",
}
_RETRYABLE = {
    "invalid_request": False,
    "invalid_audio": False,
    "provider_unavailable": True,
    "provider_error": True,
    "invalid_provider_output": True,
}


class VADError(RuntimeError):
    def __init__(self, code: str, *, diagnostic: str = "") -> None:
        if code not in _SAFE_MESSAGES:
            raise ValueError(f"unknown VAD error code {code!r}")
        super().__init__(_SAFE_MESSAGES[code])
        self.code = code
        self.retryable = _RETRYABLE[code]
        self.diagnostic = diagnostic


class VadEngine(Protocol):
    def ensure_ready(self) -> str: ...
    def analyze_path(self, audio_path: Path) -> list[dict[str, Any]]: ...


def normalize_request_id(value: str | None) -> str | None:
    candidate = (value or "").strip()
    return candidate if REQUEST_ID_PATTERN.fullmatch(candidate) else None


def wav_metadata(audio_bytes: bytes) -> dict[str, float | int]:
    if not isinstance(audio_bytes, (bytes, bytearray)) or not audio_bytes:
        raise VADError("invalid_audio")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise VADError("invalid_request", diagnostic="audio exceeds byte limit")
    try:
        with wave.open(io.BytesIO(bytes(audio_bytes)), "rb") as audio:
            channels = audio.getnchannels()
            sample_width = audio.getsampwidth()
            sample_rate = audio.getframerate()
            frames = audio.getnframes()
            compression = audio.getcomptype()
    except (EOFError, wave.Error) as exc:
        raise VADError("invalid_audio") from exc
    if compression != "NONE":
        raise VADError("invalid_audio", diagnostic="compressed WAV is unsupported")
    if channels < 1 or channels > 2:
        raise VADError("invalid_audio", diagnostic="unsupported channel count")
    if sample_width not in {1, 2, 3, 4}:
        raise VADError("invalid_audio", diagnostic="unsupported sample width")
    if sample_rate < 8000 or sample_rate > 192000 or frames <= 0:
        raise VADError("invalid_audio", diagnostic="invalid sample rate or frame count")
    duration = frames / sample_rate
    if not math.isfinite(duration) or duration <= 0 or duration > MAX_AUDIO_SECONDS:
        raise VADError("invalid_request", diagnostic="audio duration exceeds contract limit")
    return {
        "channels": channels,
        "sampleWidthBytes": sample_width,
        "sampleRate": sample_rate,
        "frames": frames,
        "durationSeconds": duration,
    }


def validate_segments(raw_segments: object, duration_seconds: float) -> list[dict[str, float]]:
    if not isinstance(raw_segments, list) or len(raw_segments) > MAX_SEGMENTS:
        raise VADError("invalid_provider_output")
    normalized: list[dict[str, float]] = []
    previous_end = 0.0
    for item in raw_segments:
        if not isinstance(item, dict):
            raise VADError("invalid_provider_output")
        start = item.get("start")
        end = item.get("end")
        if isinstance(start, bool) or isinstance(end, bool) or not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise VADError("invalid_provider_output")
        start_value = float(start)
        end_value = float(end)
        if not math.isfinite(start_value) or not math.isfinite(end_value):
            raise VADError("invalid_provider_output")
        if start_value < 0 or end_value <= start_value or end_value > duration_seconds + 0.001:
            raise VADError("invalid_provider_output")
        if normalized and start_value < previous_end - 0.001:
            raise VADError("invalid_provider_output")
        normalized.append(
            {
                "startSeconds": round(start_value, 6),
                "endSeconds": round(min(end_value, duration_seconds), 6),
            }
        )
        previous_end = end_value
    return normalized


class SileroVadEngine:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._model: object | None = None
        self._get_speech_timestamps = None
        self._read_audio = None
        self._version = "unknown"

    def ensure_ready(self) -> str:
        with self._lock:
            if self._model is not None:
                return self._version
            try:
                import silero_vad  # type: ignore
                from silero_vad import get_speech_timestamps, load_silero_vad, read_audio  # type: ignore

                model = load_silero_vad()
            except Exception as exc:
                raise VADError("provider_unavailable") from exc
            self._model = model
            self._get_speech_timestamps = get_speech_timestamps
            self._read_audio = read_audio
            self._version = str(getattr(silero_vad, "__version__", "unknown"))
            return self._version

    def analyze_path(self, audio_path: Path) -> list[dict[str, Any]]:
        with self._lock:
            self.ensure_ready()
            assert self._model is not None
            assert self._get_speech_timestamps is not None
            assert self._read_audio is not None
            try:
                audio = self._read_audio(str(audio_path), sampling_rate=TARGET_SAMPLE_RATE)
                segments = self._get_speech_timestamps(
                    audio,
                    self._model,
                    sampling_rate=TARGET_SAMPLE_RATE,
                    return_seconds=True,
                )
            except Exception as exc:
                raise VADError("provider_error") from exc
        if not isinstance(segments, list):
            raise VADError("invalid_provider_output")
        return segments


_ENGINE: SileroVadEngine | None = None
_ENGINE_LOCK = threading.Lock()


def get_engine() -> SileroVadEngine:
    global _ENGINE
    with _ENGINE_LOCK:
        if _ENGINE is None:
            _ENGINE = SileroVadEngine()
        return _ENGINE


class VADAnalyzer:
    def __init__(self, *, engine: VadEngine | None = None, work_root: Path | None = None) -> None:
        self.engine = engine or get_engine()
        configured_root = os.getenv("VAD_WORK_ROOT", "").strip()
        self.work_root = work_root or (Path(configured_root) if configured_root else None)
        if self.work_root is not None:
            self.work_root = self.work_root.resolve()
            self.work_root.mkdir(parents=True, exist_ok=True)

    def analyze(self, audio_bytes: bytes) -> dict[str, object]:
        metadata = wav_metadata(audio_bytes)
        duration = float(metadata["durationSeconds"])
        parent = str(self.work_root) if self.work_root is not None else None
        with tempfile.TemporaryDirectory(prefix="interview-vad-", dir=parent) as directory:
            audio_path = Path(directory).resolve() / "input.wav"
            audio_path.write_bytes(bytes(audio_bytes))
            try:
                raw_segments = self.engine.analyze_path(audio_path)
            except VADError:
                raise
            except Exception as exc:
                raise VADError("provider_error") from exc
            segments = validate_segments(raw_segments, duration)
        return {
            "speechDetected": bool(segments),
            "segments": segments,
            "sampleRate": TARGET_SAMPLE_RATE,
            "durationSeconds": round(duration, 6),
        }


def vad_status(*, shared_secret: str | None = None, engine: VadEngine | None = None) -> dict[str, object]:
    secret = shared_secret if shared_secret is not None else os.getenv("MEDIA_WORKER_SHARED_SECRET", "").strip()
    base: dict[str, object] = {
        "contractVersion": CONTRACT_VERSION,
        "provider": PROVIDER,
        "supportedContentTypes": list(SUPPORTED_CONTENT_TYPES),
        "maxAudioBytes": MAX_AUDIO_BYTES,
        "maxAudioSeconds": MAX_AUDIO_SECONDS,
        "targetSampleRate": TARGET_SAMPLE_RATE,
        "independentOf": ["llm", "whisper", "livekit", "ffmpeg", "tts"],
    }
    if not secret:
        return {**base, "ready": False, "reason": "VAD shared secret is not configured"}
    selected_engine = engine or get_engine()
    try:
        version = selected_engine.ensure_ready()
    except VADError as exc:
        return {**base, "ready": False, "reason": str(exc)}
    except Exception:
        return {**base, "ready": False, "reason": _SAFE_MESSAGES["provider_unavailable"]}
    return {**base, "ready": True, "engineVersion": version}
