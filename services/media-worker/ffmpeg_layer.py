from __future__ import annotations

import os
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

from realtime_metrics import record_ffmpeg_job, set_ffmpeg_active_processes

CONTRACT_VERSION = "ffmpeg-integration.v1"
PROVIDER = "ffmpeg"
OPERATIONS = ("ingest", "transcode", "mux", "segment", "recording_finalize")
DEFAULT_TIMEOUT_SECONDS = 120.0
MIN_TIMEOUT_SECONDS = 0.05
MAX_TIMEOUT_SECONDS = 600.0
DEFAULT_TERMINATION_GRACE_SECONDS = 2.0
MIN_TERMINATION_GRACE_SECONDS = 0.05
MAX_TERMINATION_GRACE_SECONDS = 10.0
POLL_INTERVAL_SECONDS = 0.02
DIAGNOSTIC_MAX_BYTES = 8192
_SEGMENT_PATTERN = re.compile(r"%0?\d*d")

_SAFE_MESSAGES = {
    "invalid_request": "FFmpeg job request is invalid",
    "executable_not_found": "FFmpeg executable is not available",
    "process_start_failed": "FFmpeg process could not be started",
    "process_timeout": "FFmpeg process exceeded its timeout",
    "process_cancelled": "FFmpeg process was cancelled",
    "process_failed": "FFmpeg process exited unsuccessfully",
    "output_missing": "FFmpeg did not produce the required output",
    "output_empty": "FFmpeg produced an empty output",
    "cleanup_failed": "FFmpeg temporary workspace cleanup failed",
}
_ERROR_RESULTS = {
    "invalid_request": "error",
    "executable_not_found": "unavailable",
    "process_start_failed": "unavailable",
    "process_timeout": "timeout",
    "process_cancelled": "cancelled",
    "process_failed": "error",
    "output_missing": "error",
    "output_empty": "error",
    "cleanup_failed": "error",
}
_ERROR_RETRYABLE = {
    "invalid_request": False,
    "executable_not_found": False,
    "process_start_failed": False,
    "process_timeout": True,
    "process_cancelled": False,
    "process_failed": False,
    "output_missing": False,
    "output_empty": False,
    "cleanup_failed": False,
}


class FFmpegError(RuntimeError):
    def __init__(
        self,
        code: str,
        operation: str,
        *,
        exit_code: int | None = None,
        diagnostic: str = "",
    ) -> None:
        if code not in _SAFE_MESSAGES:
            raise ValueError(f"unknown FFmpeg error code {code!r}")
        super().__init__(_SAFE_MESSAGES[code])
        self.code = code
        self.operation = operation
        self.exit_code = exit_code
        self.diagnostic = diagnostic
        self.result = _ERROR_RESULTS[code]
        self.retryable = _ERROR_RETRYABLE[code]


@dataclass(frozen=True)
class FFmpegJobSpec:
    operation: str
    workspace: Path
    inputs: tuple[Path, ...]
    output: Path
    segment_seconds: float | None = None
    input_duration_seconds: float | None = None


@dataclass(frozen=True)
class FFmpegProcessResult:
    operation: str
    command: tuple[str, ...]
    exit_code: int
    duration_seconds: float
    outputs: tuple[Path, ...]
    input_bytes: int
    output_bytes: int
    diagnostic: str


def _validate_operation(operation: str) -> str:
    if operation not in OPERATIONS:
        raise FFmpegError("invalid_request", operation)
    return operation


def _bounded_float(value: float, minimum: float, maximum: float, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise FFmpegError("invalid_request", "unknown", diagnostic=f"{name} is invalid") from exc
    if not minimum <= number <= maximum:
        raise FFmpegError("invalid_request", "unknown", diagnostic=f"{name} out of bounds")
    return number


def _resolve_inside(workspace: Path, candidate: Path) -> Path:
    root = workspace.resolve()
    path = candidate.resolve(strict=False)
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise FFmpegError("invalid_request", "unknown", diagnostic="path escapes workspace") from exc
    return path


def _safe_segment_glob(output: Path) -> str:
    if not _SEGMENT_PATTERN.search(output.name):
        raise FFmpegError("invalid_request", "segment", diagnostic="segment output requires numeric pattern")
    return _SEGMENT_PATTERN.sub("*", output.name)


def resolve_ffmpeg_executable(value: str) -> str | None:
    candidate = value.strip()
    if not candidate:
        return None
    direct = Path(candidate)
    if direct.is_file() and (os.name == "nt" or os.access(direct, os.X_OK)):
        return str(direct.resolve())
    return shutil.which(candidate)


def ffmpeg_status(*, enabled: bool | None = None, executable: str | None = None) -> dict[str, object]:
    if enabled is None:
        enabled = os.getenv("FFMPEG_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
    configured = (executable if executable is not None else os.getenv("FFMPEG_CLI", "ffmpeg")).strip() or "ffmpeg"
    base: dict[str, object] = {
        "contractVersion": CONTRACT_VERSION,
        "provider": PROVIDER,
        "enabled": bool(enabled),
    }
    if not enabled:
        return {**base, "ready": False, "reason": "disabled"}
    resolved = resolve_ffmpeg_executable(configured)
    if resolved is None:
        return {**base, "ready": False, "reason": "FFMPEG_CLI not found"}
    return {**base, "ready": True, "command": Path(resolved).name}


class FFmpegCommandBuilder:
    def __init__(self, executable: str = "ffmpeg") -> None:
        self.executable = executable.strip() or "ffmpeg"

    def build(self, spec: FFmpegJobSpec) -> tuple[str, ...]:
        operation = _validate_operation(spec.operation)
        workspace = spec.workspace.resolve()
        if not workspace.is_dir():
            raise FFmpegError("invalid_request", operation, diagnostic="workspace does not exist")
        inputs = tuple(_resolve_inside(workspace, item) for item in spec.inputs)
        output = _resolve_inside(workspace, spec.output)
        if output in inputs:
            raise FFmpegError("invalid_request", operation, diagnostic="output cannot overwrite input")
        if any(not item.is_file() for item in inputs):
            raise FFmpegError("invalid_request", operation, diagnostic="input is missing")
        expected_count = 2 if operation == "mux" else 1
        if len(inputs) != expected_count:
            raise FFmpegError("invalid_request", operation, diagnostic="unexpected input count")
        output.parent.mkdir(parents=True, exist_ok=True)

        command = [self.executable, "-hide_banner", "-nostdin", "-loglevel", "error", "-y"]
        if operation == "ingest":
            command += [
                "-i", str(inputs[0]), "-map", "0:a:0", "-vn", "-sn", "-dn",
                "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(output),
            ]
        elif operation == "transcode":
            command += [
                "-i", str(inputs[0]), "-map", "0:v:0?", "-map", "0:a:0?",
                "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-movflags", "+faststart", str(output),
            ]
        elif operation == "mux":
            command += [
                "-i", str(inputs[0]), "-i", str(inputs[1]), "-map", "0:v:0", "-map", "1:a:0",
                "-c:v", "copy", "-c:a", "aac", "-shortest", "-movflags", "+faststart", str(output),
            ]
        elif operation == "segment":
            if spec.segment_seconds is None or not 0.25 <= float(spec.segment_seconds) <= 3600:
                raise FFmpegError("invalid_request", operation, diagnostic="segment duration out of bounds")
            _safe_segment_glob(output)
            command += [
                "-i", str(inputs[0]), "-map", "0", "-c", "copy", "-f", "segment",
                "-segment_time", format(float(spec.segment_seconds), ".6g"),
                "-reset_timestamps", "1", str(output),
            ]
        else:
            command += [
                "-i", str(inputs[0]), "-map", "0", "-c", "copy", "-movflags", "+faststart", str(output),
            ]
        return tuple(command)

    @staticmethod
    def expected_outputs(spec: FFmpegJobSpec) -> tuple[Path, ...]:
        output = _resolve_inside(spec.workspace.resolve(), spec.output)
        if spec.operation == "segment":
            return tuple(sorted(output.parent.glob(_safe_segment_glob(output))))
        return (output,)


class FFmpegWorkspace:
    def __init__(self, parent: Path | None = None) -> None:
        if parent is None:
            configured = os.getenv("FFMPEG_WORK_ROOT", "").strip()
            parent = Path(configured) if configured else None
        if parent is not None:
            parent = parent.resolve()
            parent.mkdir(parents=True, exist_ok=True)
        self.root = Path(
            tempfile.mkdtemp(prefix="interview-ffmpeg-", dir=str(parent) if parent is not None else None)
        ).resolve()
        self._closed = False

    def path(self, relative: str) -> Path:
        if self._closed:
            raise FFmpegError("invalid_request", "unknown", diagnostic="workspace is closed")
        rel = Path(relative)
        if rel.is_absolute() or any(part == ".." for part in rel.parts):
            raise FFmpegError("invalid_request", "unknown", diagnostic="invalid workspace path")
        target = _resolve_inside(self.root, self.root / rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        return target

    def write_bytes(self, relative: str, data: bytes) -> Path:
        target = self.path(relative)
        target.write_bytes(data)
        return target

    def cleanup(self) -> None:
        if self._closed:
            return
        self._closed = True

        def retry_remove(function, path, _exc_info):
            os.chmod(path, 0o700)
            function(path)

        try:
            shutil.rmtree(self.root, onerror=retry_remove)
        except OSError as exc:
            raise FFmpegError("cleanup_failed", "unknown") from exc

    def __enter__(self) -> "FFmpegWorkspace":
        return self

    def __exit__(self, _exc_type, exc, _traceback) -> bool:
        try:
            self.cleanup()
        except FFmpegError as cleanup_error:
            if exc is None:
                raise
            if hasattr(exc, "add_note"):
                exc.add_note(str(cleanup_error))
        return False


_ACTIVE_LOCK = threading.Lock()
_ACTIVE_BY_OPERATION = {operation: 0 for operation in OPERATIONS}


def _adjust_active(operation: str, delta: int) -> None:
    with _ACTIVE_LOCK:
        current = max(0, _ACTIVE_BY_OPERATION[operation] + delta)
        _ACTIVE_BY_OPERATION[operation] = current
    set_ffmpeg_active_processes(operation, current)


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


def _output_stats(paths: Sequence[Path], operation: str) -> int:
    if not paths:
        raise FFmpegError("output_missing", operation)
    total = 0
    for path in paths:
        if not path.is_file():
            raise FFmpegError("output_missing", operation)
        size = path.stat().st_size
        if size <= 0:
            raise FFmpegError("output_empty", operation)
        total += size
    return total


class FFmpegProcessRunner:
    def __init__(
        self,
        *,
        builder: FFmpegCommandBuilder | None = None,
        timeout_seconds: float | None = None,
        termination_grace_seconds: float | None = None,
    ) -> None:
        self.builder = builder or FFmpegCommandBuilder(os.getenv("FFMPEG_CLI", "ffmpeg"))
        timeout = timeout_seconds if timeout_seconds is not None else os.getenv("FFMPEG_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS))
        grace = (
            termination_grace_seconds
            if termination_grace_seconds is not None
            else os.getenv("FFMPEG_TERMINATION_GRACE_SECONDS", str(DEFAULT_TERMINATION_GRACE_SECONDS))
        )
        self.timeout_seconds = _bounded_float(float(timeout), MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS, "timeout_seconds")
        self.termination_grace_seconds = _bounded_float(
            float(grace), MIN_TERMINATION_GRACE_SECONDS, MAX_TERMINATION_GRACE_SECONDS, "termination_grace_seconds"
        )

    def run(self, spec: FFmpegJobSpec, *, cancel_event: threading.Event | None = None) -> FFmpegProcessResult:
        operation = _validate_operation(spec.operation)
        resolved = resolve_ffmpeg_executable(self.builder.executable)
        if resolved is None:
            record_ffmpeg_job(operation=operation, result="unavailable", processing_duration_seconds=0.0)
            raise FFmpegError("executable_not_found", operation)
        command = list(self.builder.build(spec))
        command[0] = resolved
        return self.run_command(
            tuple(command),
            operation=operation,
            workspace=spec.workspace,
            expected_output=lambda: self.builder.expected_outputs(spec),
            input_paths=spec.inputs,
            input_duration_seconds=spec.input_duration_seconds,
            cancel_event=cancel_event,
        )

    def run_command(
        self,
        command: Sequence[str],
        *,
        operation: str,
        workspace: Path,
        expected_output: Callable[[], Sequence[Path]],
        input_paths: Sequence[Path] = (),
        input_duration_seconds: float | None = None,
        cancel_event: threading.Event | None = None,
    ) -> FFmpegProcessResult:
        operation = _validate_operation(operation)
        root = workspace.resolve()
        if not root.is_dir() or not command:
            raise FFmpegError("invalid_request", operation)
        if cancel_event is not None and cancel_event.is_set():
            record_ffmpeg_job(operation=operation, result="cancelled", processing_duration_seconds=0.0)
            raise FFmpegError("process_cancelled", operation)

        normalized_inputs = tuple(_resolve_inside(root, item) for item in input_paths)
        input_bytes = sum(path.stat().st_size for path in normalized_inputs if path.is_file())
        started_at = time.perf_counter()
        process: subprocess.Popen[bytes] | None = None
        active = False

        with tempfile.TemporaryFile() as stdout_handle, tempfile.TemporaryFile() as stderr_handle:
            kwargs: dict[str, object] = {}
            if os.name == "posix":
                kwargs["start_new_session"] = True
            elif os.name == "nt":
                kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
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
                duration = max(0.0, time.perf_counter() - started_at)
                record_ffmpeg_job(operation=operation, result="unavailable", processing_duration_seconds=duration)
                raise FFmpegError("process_start_failed", operation) from exc

            _adjust_active(operation, 1)
            active = True
            try:
                deadline = started_at + self.timeout_seconds
                terminal: str | None = None
                while process.poll() is None:
                    if cancel_event is not None and cancel_event.is_set():
                        terminal = "cancelled"
                        _terminate_process_tree(process, self.termination_grace_seconds)
                        break
                    if time.perf_counter() >= deadline:
                        terminal = "timeout"
                        _terminate_process_tree(process, self.termination_grace_seconds)
                        break
                    time.sleep(POLL_INTERVAL_SECONDS)

                duration = max(0.0, time.perf_counter() - started_at)
                diagnostic = _read_diagnostic(stderr_handle, root)
                if terminal is not None:
                    result = "cancelled" if terminal == "cancelled" else "timeout"
                    exit_class = "signal" if terminal == "cancelled" else "timeout"
                    record_ffmpeg_job(
                        operation=operation,
                        result=result,
                        processing_duration_seconds=duration,
                        input_duration_seconds=input_duration_seconds,
                        input_bytes=input_bytes,
                        exit_class=exit_class,
                    )
                    raise FFmpegError(
                        "process_cancelled" if terminal == "cancelled" else "process_timeout",
                        operation,
                        exit_code=process.returncode,
                        diagnostic=diagnostic,
                    )

                return_code = int(process.returncode or 0)
                if return_code != 0:
                    record_ffmpeg_job(
                        operation=operation,
                        result="error",
                        processing_duration_seconds=duration,
                        input_duration_seconds=input_duration_seconds,
                        input_bytes=input_bytes,
                        exit_class="signal" if return_code < 0 else "nonzero",
                    )
                    raise FFmpegError("process_failed", operation, exit_code=return_code, diagnostic=diagnostic)

                outputs = tuple(expected_output())
                try:
                    output_bytes = _output_stats(outputs, operation)
                except FFmpegError:
                    record_ffmpeg_job(
                        operation=operation,
                        result="error",
                        processing_duration_seconds=duration,
                        input_duration_seconds=input_duration_seconds,
                        input_bytes=input_bytes,
                        exit_class="zero",
                    )
                    raise
                record_ffmpeg_job(
                    operation=operation,
                    result="success",
                    processing_duration_seconds=duration,
                    input_duration_seconds=input_duration_seconds,
                    input_bytes=input_bytes,
                    output_bytes=output_bytes,
                    exit_class="zero",
                )
                return FFmpegProcessResult(
                    operation=operation,
                    command=tuple(str(item) for item in command),
                    exit_code=0,
                    duration_seconds=duration,
                    outputs=outputs,
                    input_bytes=input_bytes,
                    output_bytes=output_bytes,
                    diagnostic=diagnostic,
                )
            finally:
                if process.poll() is None:
                    _terminate_process_tree(process, self.termination_grace_seconds)
                if active:
                    _adjust_active(operation, -1)
