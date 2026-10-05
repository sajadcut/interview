from __future__ import annotations

import os
import subprocess
import tempfile
import time
from pathlib import Path

from tts_layer import (
    CONTRACT_VERSION,
    DIAGNOSTIC_MAX_BYTES,
    MAX_AUDIO_BYTES,
    MAX_TEXT_CHARS,
    POLL_INTERVAL_SECONDS,
    TTSError,
    _read_diagnostic,
    _terminate_process_tree,
    bounded_float,
    normalize_persian_spoken_text,
    resolve_executable,
)

PROVIDER = "edge-tts"
CONTENT_TYPE = "audio/mpeg"
DEFAULT_VOICE = "fa-IR-FaridNeural"
DEFAULT_TIMEOUT_SECONDS = 60.0
MIN_TIMEOUT_SECONDS = 0.05
MAX_TIMEOUT_SECONDS = 300.0
DEFAULT_TERMINATION_GRACE_SECONDS = 2.0
MIN_TERMINATION_GRACE_SECONDS = 0.05
MAX_TERMINATION_GRACE_SECONDS = 10.0


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
        executable: str | None = None,
        voice: str | None = None,
        rate: str | None = None,
        volume: str | None = None,
        pitch: str | None = None,
        proxy: str | None = None,
        timeout_seconds: float | None = None,
        termination_grace_seconds: float | None = None,
        work_root: Path | None = None,
    ) -> None:
        executable_name = executable if executable is not None else os.getenv("TTS_EDGE_EXECUTABLE", "edge-tts")
        self.executable = resolve_executable(executable_name)
        if not self.executable:
            raise TTSError("provider_unavailable", diagnostic="edge-tts executable was not found")

        self.voice = _validated_voice(voice if voice is not None else os.getenv("TTS_EDGE_VOICE", DEFAULT_VOICE))
        self.rate = _validated_prosody(rate if rate is not None else os.getenv("TTS_EDGE_RATE", "+0%"), "TTS_EDGE_RATE", "%")
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
        grace = termination_grace_seconds if termination_grace_seconds is not None else os.getenv(
            "TTS_TERMINATION_GRACE_SECONDS", str(DEFAULT_TERMINATION_GRACE_SECONDS)
        )
        self.timeout_seconds = bounded_float(timeout, MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS, "TTS_TIMEOUT_SECONDS")
        self.termination_grace_seconds = bounded_float(
            grace,
            MIN_TERMINATION_GRACE_SECONDS,
            MAX_TERMINATION_GRACE_SECONDS,
            "TTS_TERMINATION_GRACE_SECONDS",
        )
        configured_root = os.getenv("TTS_WORK_ROOT", "").strip()
        self.work_root = work_root or (Path(configured_root) if configured_root else None)
        if self.work_root is not None:
            self.work_root = self.work_root.resolve()
            self.work_root.mkdir(parents=True, exist_ok=True)

    def synthesize(self, spoken_text: str) -> bytes:
        if not isinstance(spoken_text, str):
            raise TTSError("invalid_request")
        normalized = normalize_persian_spoken_text(spoken_text.strip())
        if not normalized or len(normalized) > MAX_TEXT_CHARS or "\x00" in normalized:
            raise TTSError("invalid_request")

        parent = str(self.work_root) if self.work_root is not None else None
        with tempfile.TemporaryDirectory(prefix="interview-edge-tts-", dir=parent) as directory:
            root = Path(directory).resolve()
            text_file = root / "spoken.txt"
            output_mp3 = root / "speech.mp3"
            text_file.write_text(normalized, encoding="utf-8")
            command = [
                self.executable,
                "--voice",
                self.voice,
                "--file",
                str(text_file),
                f"--rate={self.rate}",
                f"--volume={self.volume}",
                f"--pitch={self.pitch}",
                "--write-media",
                str(output_mp3),
            ]
            if self.proxy:
                command.extend(["--proxy", self.proxy])

            kwargs: dict[str, object] = {}
            if os.name == "posix":
                kwargs["start_new_session"] = True
            elif os.name == "nt":
                kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)

            process: subprocess.Popen[bytes] | None = None
            with tempfile.TemporaryFile() as stdout_handle, tempfile.TemporaryFile() as stderr_handle:
                try:
                    process = subprocess.Popen(
                        command,
                        cwd=str(root),
                        stdin=subprocess.DEVNULL,
                        stdout=stdout_handle,
                        stderr=stderr_handle,
                        shell=False,
                        close_fds=True,
                        **kwargs,
                    )
                except OSError as exc:
                    raise TTSError("provider_unavailable") from exc

                deadline = time.perf_counter() + self.timeout_seconds
                try:
                    while process.poll() is None:
                        if time.perf_counter() >= deadline:
                            _terminate_process_tree(process, self.termination_grace_seconds)
                            raise TTSError(
                                "provider_timeout",
                                diagnostic=_read_diagnostic(stderr_handle, root),
                                exit_code=process.returncode,
                            )
                        time.sleep(POLL_INTERVAL_SECONDS)

                    return_code = int(process.returncode or 0)
                    diagnostic = _read_diagnostic(stderr_handle, root)
                    if return_code != 0:
                        raise TTSError("provider_error", diagnostic=diagnostic, exit_code=return_code)
                    if not output_mp3.is_file():
                        raise TTSError("invalid_audio_output", diagnostic="MP3 output is missing")
                    audio = output_mp3.read_bytes()
                    validate_mp3_bytes(audio)
                    return audio
                finally:
                    if process is not None and process.poll() is None:
                        _terminate_process_tree(process, self.termination_grace_seconds)


def edge_tts_status(*, shared_secret: str | None = None, executable: str | None = None) -> dict[str, object]:
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
    executable_name = executable if executable is not None else os.getenv("TTS_EDGE_EXECUTABLE", "edge-tts")
    resolved = resolve_executable(executable_name)
    if not resolved:
        return {**base, "ready": False, "reason": "edge-tts executable was not found"}
    try:
        _validated_voice(os.getenv("TTS_EDGE_VOICE", DEFAULT_VOICE))
        _validated_prosody(os.getenv("TTS_EDGE_RATE", "+0%"), "TTS_EDGE_RATE", "%")
        _validated_prosody(os.getenv("TTS_EDGE_VOLUME", "+0%"), "TTS_EDGE_VOLUME", "%")
        _validated_prosody(os.getenv("TTS_EDGE_PITCH", "+0Hz"), "TTS_EDGE_PITCH", "Hz")
    except TTSError as exc:
        return {**base, "ready": False, "reason": str(exc)}
    return {**base, "ready": True, "command": Path(resolved).name}
