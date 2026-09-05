from __future__ import annotations

import os
import re
import shlex
import shutil
import signal
import subprocess
import tempfile
import time
import wave
from pathlib import Path

CONTRACT_VERSION = "tts-synthesis.v1"
PROVIDER = "local-command"
MAX_TEXT_CHARS = 4000
MAX_AUDIO_BYTES = 20 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 60.0
MIN_TIMEOUT_SECONDS = 0.05
MAX_TIMEOUT_SECONDS = 300.0
DEFAULT_TERMINATION_GRACE_SECONDS = 2.0
MIN_TERMINATION_GRACE_SECONDS = 0.05
MAX_TERMINATION_GRACE_SECONDS = 10.0
DIAGNOSTIC_MAX_BYTES = 8192
POLL_INTERVAL_SECONDS = 0.02
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
_PLACEHOLDER_PATTERN = re.compile(r"\{[^{}]+\}")
_REQUIRED_PLACEHOLDERS = {"{text_file}", "{output_wav}"}

_SAFE_MESSAGES = {
    "invalid_request": "TTS request is invalid",
    "not_configured": "TTS engine is not configured",
    "provider_unavailable": "TTS engine is unavailable",
    "provider_timeout": "TTS engine timed out",
    "provider_error": "TTS engine failed",
    "invalid_audio_output": "TTS engine produced invalid audio",
}
_RETRYABLE = {
    "invalid_request": False,
    "not_configured": False,
    "provider_unavailable": True,
    "provider_timeout": True,
    "provider_error": True,
    "invalid_audio_output": True,
}


class TTSError(RuntimeError):
    def __init__(self, code: str, *, diagnostic: str = "", exit_code: int | None = None) -> None:
        if code not in _SAFE_MESSAGES:
            raise ValueError(f"unknown TTS error code {code!r}")
        super().__init__(_SAFE_MESSAGES[code])
        self.code = code
        self.retryable = _RETRYABLE[code]
        self.diagnostic = diagnostic
        self.exit_code = exit_code


def bounded_float(value: object, minimum: float, maximum: float, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise TTSError("not_configured", diagnostic=f"{name} is invalid") from exc
    if not minimum <= number <= maximum:
        raise TTSError("not_configured", diagnostic=f"{name} out of bounds")
    return number


def normalize_request_id(value: str | None) -> str | None:
    candidate = (value or "").strip()
    return candidate if REQUEST_ID_PATTERN.fullmatch(candidate) else None


def resolve_executable(value: str) -> str | None:
    candidate = value.strip()
    if not candidate:
        return None
    direct = Path(candidate)
    if direct.is_file() and (os.name == "nt" or os.access(direct, os.X_OK)):
        return str(direct.resolve())
    return shutil.which(candidate)


def _resolve_inside(root: Path, candidate: Path) -> Path:
    workspace = root.resolve()
    path = candidate.resolve(strict=False)
    try:
        path.relative_to(workspace)
    except ValueError as exc:
        raise TTSError("invalid_request", diagnostic="path escapes TTS workspace") from exc
    return path


class TTSCommandBuilder:
    def __init__(self, template: str) -> None:
        self.template = template.strip()

    def _tokens(self) -> tuple[str, ...]:
        if not self.template or len(self.template) > 8192:
            raise TTSError("not_configured", diagnostic="TTS_COMMAND is missing or too long")
        try:
            tokens = tuple(shlex.split(self.template, posix=os.name != "nt"))
        except ValueError as exc:
            raise TTSError("not_configured", diagnostic="TTS_COMMAND cannot be parsed") from exc
        if not tokens:
            raise TTSError("not_configured", diagnostic="TTS_COMMAND is empty")
        placeholders = set(_PLACEHOLDER_PATTERN.findall(self.template))
        if placeholders != _REQUIRED_PLACEHOLDERS:
            raise TTSError(
                "not_configured",
                diagnostic="TTS_COMMAND must use exactly {text_file} and {output_wav}",
            )
        return tokens

    def resolved_executable(self) -> str:
        tokens = self._tokens()
        resolved = resolve_executable(tokens[0])
        if not resolved:
            raise TTSError("provider_unavailable", diagnostic="TTS executable was not found")
        return resolved

    def build(self, workspace: Path, text_file: Path, output_wav: Path) -> tuple[str, ...]:
        root = workspace.resolve()
        if not root.is_dir():
            raise TTSError("invalid_request", diagnostic="TTS workspace does not exist")
        text_path = _resolve_inside(root, text_file)
        output_path = _resolve_inside(root, output_wav)
        if not text_path.is_file():
            raise TTSError("invalid_request", diagnostic="TTS input text file is missing")
        tokens = self._tokens()
        resolved = self.resolved_executable()
        rendered = [resolved]
        for token in tokens[1:]:
            rendered.append(
                token.replace("{text_file}", str(text_path)).replace("{output_wav}", str(output_path))
            )
        return tuple(rendered)


def _read_diagnostic(handle, workspace: Path) -> str:
    handle.flush()
    handle.seek(0, os.SEEK_END)
    size = handle.tell()
    handle.seek(max(0, size - DIAGNOSTIC_MAX_BYTES), os.SEEK_SET)
    raw = handle.read(DIAGNOSTIC_MAX_BYTES)
    text = raw.decode("utf-8", errors="replace").replace(str(workspace), "<workspace>")
    text = "".join(char if char in "\n\t" or ord(char) >= 32 else " " for char in text)
    return text.strip()


def _terminate_process_tree(process: subprocess.Popen[bytes], grace_seconds: float) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
    except (ProcessLookupError, PermissionError, OSError):
        pass
    try:
        process.wait(timeout=grace_seconds)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
    except (ProcessLookupError, PermissionError, OSError):
        pass
    try:
        process.wait(timeout=grace_seconds)
    except subprocess.TimeoutExpired:
        pass


def validate_wav(path: Path) -> None:
    if not path.is_file():
        raise TTSError("invalid_audio_output", diagnostic="WAV output is missing")
    size = path.stat().st_size
    if size <= 0 or size > MAX_AUDIO_BYTES:
        raise TTSError("invalid_audio_output", diagnostic="WAV output is empty or oversized")
    try:
        with wave.open(str(path), "rb") as audio:
            channels = audio.getnchannels()
            sample_width = audio.getsampwidth()
            sample_rate = audio.getframerate()
            frames = audio.getnframes()
            if channels <= 0 or channels > 8:
                raise TTSError("invalid_audio_output", diagnostic="invalid WAV channel count")
            if sample_width not in {1, 2, 3, 4}:
                raise TTSError("invalid_audio_output", diagnostic="invalid WAV sample width")
            if sample_rate < 8000 or sample_rate > 192000:
                raise TTSError("invalid_audio_output", diagnostic="invalid WAV sample rate")
            if frames <= 0:
                raise TTSError("invalid_audio_output", diagnostic="WAV contains no audio frames")
    except (EOFError, wave.Error) as exc:
        raise TTSError("invalid_audio_output", diagnostic="output is not a valid WAV file") from exc


class TTSProcessRunner:
    def __init__(
        self,
        *,
        command_template: str | None = None,
        timeout_seconds: float | None = None,
        termination_grace_seconds: float | None = None,
        work_root: Path | None = None,
    ) -> None:
        template = command_template if command_template is not None else os.getenv("TTS_COMMAND", "")
        self.builder = TTSCommandBuilder(template)
        timeout = timeout_seconds if timeout_seconds is not None else os.getenv("TTS_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS))
        grace = (
            termination_grace_seconds
            if termination_grace_seconds is not None
            else os.getenv("TTS_TERMINATION_GRACE_SECONDS", str(DEFAULT_TERMINATION_GRACE_SECONDS))
        )
        self.timeout_seconds = bounded_float(timeout, MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS, "TTS_TIMEOUT_SECONDS")
        self.termination_grace_seconds = bounded_float(
            grace,
            MIN_TERMINATION_GRACE_SECONDS,
            MAX_TERMINATION_GRACE_SECONDS,
            "TTS_TERMINATION_GRACE_SECONDS",
        )
        configured_root = os.getenv("TTS_WORK_ROOT", "").strip()
        self.work_root = (work_root or (Path(configured_root) if configured_root else None))
        if self.work_root is not None:
            self.work_root = self.work_root.resolve()
            self.work_root.mkdir(parents=True, exist_ok=True)

    def synthesize(self, spoken_text: str) -> bytes:
        if not isinstance(spoken_text, str):
            raise TTSError("invalid_request")
        normalized = spoken_text.strip()
        if not normalized or len(normalized) > MAX_TEXT_CHARS or "\x00" in normalized:
            raise TTSError("invalid_request")

        parent = str(self.work_root) if self.work_root is not None else None
        with tempfile.TemporaryDirectory(prefix="interview-tts-", dir=parent) as directory:
            root = Path(directory).resolve()
            text_file = root / "spoken.txt"
            output_wav = root / "speech.wav"
            text_file.write_text(normalized, encoding="utf-8")
            command = self.builder.build(root, text_file, output_wav)
            kwargs: dict[str, object] = {}
            if os.name == "posix":
                kwargs["start_new_session"] = True
            elif os.name == "nt":
                kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)

            process: subprocess.Popen[bytes] | None = None
            with tempfile.TemporaryFile() as stdout_handle, tempfile.TemporaryFile() as stderr_handle:
                try:
                    process = subprocess.Popen(
                        list(command),
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
                    validate_wav(output_wav)
                    return output_wav.read_bytes()
                finally:
                    if process.poll() is None:
                        _terminate_process_tree(process, self.termination_grace_seconds)


def tts_status(
    *,
    shared_secret: str | None = None,
    command_template: str | None = None,
) -> dict[str, object]:
    secret = shared_secret if shared_secret is not None else (
        os.getenv("TTS_SHARED_SECRET", "").strip() or os.getenv("MEDIA_WORKER_SHARED_SECRET", "").strip()
    )
    base: dict[str, object] = {
        "contractVersion": CONTRACT_VERSION,
        "provider": PROVIDER,
        "maxTextChars": MAX_TEXT_CHARS,
        "maxAudioBytes": MAX_AUDIO_BYTES,
        "independentOf": ["llm", "whisper", "livekit", "ffmpeg"],
    }
    if not secret:
        return {**base, "ready": False, "reason": "TTS shared secret is not configured"}
    template = command_template if command_template is not None else os.getenv("TTS_COMMAND", "")
    try:
        builder = TTSCommandBuilder(template)
        executable = builder.resolved_executable()
    except TTSError as exc:
        return {**base, "ready": False, "reason": str(exc)}
    return {**base, "ready": True, "command": Path(executable).name}
